import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categorizeTransaction } from "@/lib/categorize";
import type { Database } from "@/lib/supabase/types";

// Wise and PayPal both block API access for personal accounts (see git history for the
// abandoned Wise API integration — PSD2 SCA blocks it permanently). This is the fallback:
// drop exported CSVs in imports/, they get parsed and moved to imports/processed/ on sync.
const IMPORTS_DIR = path.join(process.cwd(), "imports");
const PROCESSED_DIR = path.join(IMPORTS_DIR, "processed");

type Provider = "wise" | "paypal" | "sparkasse";

const PROVIDER_LABELS: Record<Provider, string> = { wise: "Wise", paypal: "PayPal", sparkasse: "Sparkasse" };

// Wise/PayPal/Sparkasse can also be connected via Enable Banking (src/lib/enableBankingSync.ts).
// If a provider has an active EB session, the CSV fallback for that provider is paused —
// both sources writing transactions for the same date range would double-count real-world
// transactions, and a content-based dedup (date/amount/description) would be unreliable
// (format differs per source; would also wrongly merge two legitimately identical
// transactions on the same day). Deterministic source partitioning instead: only one
// source is ever "live" for a given provider at a time. See also the date_from cutoff in
// enableBankingSync.ts, which handles the reverse direction (EB never re-pulling dates
// already covered by a provider's CSV-imported history).
async function getActiveEnableBankingProviders(client: SupabaseClient<Database>): Promise<Set<Provider>> {
  const { data } = await client.from("enable_banking_sessions").select("provider, expires_at");
  const active = new Set<Provider>();
  for (const row of data ?? []) {
    if (new Date(row.expires_at).getTime() > Date.now() && row.provider in PROVIDER_LABELS) {
      active.add(row.provider as Provider);
    }
  }
  return active;
}

type ParsedRow = {
  externalId: string;
  bookedAt: string; // ISO 8601
  amount: number;
  currency: string;
  rawDescription: string;
  merchantName: string | null;
};

export type CsvImportResult = {
  filesProcessed: number;
  imported: number;
  skipped: number;
  errors: string[];
};

// Minimal RFC4180 CSV parser (handles quoted fields with embedded delimiters/quotes),
// same approach as scripts/import-mcc-codes.ts.
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // skip, handled by \n
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// Bank exports arrive in whatever encoding the issuing system defaults to — Wise/PayPal
// ship UTF-8, but Sparkasse's "Umsatzanzeige" export is ISO-8859-1 (Latin-1). A strict
// UTF-8 decode throws on Latin-1 bytes like "ü" (0xFC without a valid continuation byte),
// so that failure is used as the encoding signal instead of guessing from content.
function decodeCsvBuffer(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("iso-8859-1").decode(buf);
  }
}

// Wise/PayPal exports are comma-delimited; Sparkasse's export is semicolon-delimited
// (German locale convention, since comma is the decimal separator there).
function sniffDelimiter(text: string): "," | ";" {
  const newlineIdx = text.indexOf("\n");
  const firstLine = newlineIdx >= 0 ? text.slice(0, newlineIdx) : text;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function detectFormat(headers: string[]): Provider | null {
  const set = new Set(headers.map((h) => h.trim()));
  const hasAll = (cols: string[]) => cols.every((c) => set.has(c));

  if (hasAll(["TransferWise ID", "Date", "Amount", "Currency", "Description"])) return "wise";
  if (hasAll(["Transaction ID", "Date", "Type", "Currency", "Gross", "Net"])) return "paypal";
  // German-locale PayPal "Kontoauszug" (CSR) export uses German column names for the same data.
  if (hasAll(["Datum", "Uhrzeit", "Beschreibung", "Währung", "Brutto", "Netto", "Transaktionscode"]))
    return "paypal";
  if (
    hasAll(["Auftragskonto", "Buchungstag", "Valutadatum", "Buchungstext", "Verwendungszweck", "Betrag", "Waehrung"])
  )
    return "sparkasse";
  return null;
}

// PayPal also offers a "Balance Reconciliation Report" export (merchant/business account
// reporting), a completely different multi-section format: a run header row ("RH"), a
// column-definition row ("RD"), zero or more data rows, and a footer row ("RF"). It is not
// the flat Activity/transaction CSV this importer parses, so it's called out explicitly
// with a specific message rather than falling through to the generic "format not recognized" error.
function isPayPalReconciliationReport(headers: string[]): boolean {
  return headers[0]?.trim() === "RH";
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    // Whichever separator appears last is the decimal point.
    normalized =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }

  const n = Number(normalized);
  return Number.isNaN(n) ? null : n;
}

function parseWiseDate(raw: string): string | null {
  // Wise CSV statements use DD-MM-YYYY.
  const m = raw.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  }
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function parseSparkasseDate(raw: string): string | null {
  // Sparkasse CSV uses DD.MM.YY (two-digit year) or occasionally DD.MM.YYYY.
  const m = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/);
  if (m) {
    const [, dd, mm, yy] = m;
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
  }
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function parsePayPalDate(dateRaw: string, timeRaw: string | undefined): string | null {
  const trimmed = dateRaw.trim();
  const time = (timeRaw || "00:00:00").trim();

  // German-locale PayPal export ("CSR"/Kontoauszug) uses dot-separated DD.MM.YYYY, which
  // is unambiguous — no day/month guessing needed like the slash-separated variant below.
  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, dd, mm, yyyy] = dotMatch;
    const iso = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T${time}`);
    return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
  }

  // Slash-separated PayPal exports vary by account locale (DD/MM/YYYY vs MM/DD/YYYY).
  // Disambiguate via a value > 12 where possible; otherwise default to DD/MM/YYYY (EU).
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slashMatch) {
    const fallback = new Date(`${trimmed} ${time}`);
    return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }
  const [, a, b, yyyy] = slashMatch;
  let day = a;
  let month = b;
  if (Number(a) > 12) {
    day = a;
    month = b;
  } else if (Number(b) > 12) {
    day = b;
    month = a;
  }
  const iso = new Date(`${yyyy}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time}`);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

function hashExternalId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

function rowsFromWiseCsv(headers: string[], rows: string[][]): { parsed: ParsedRow[]; rowErrors: string[] } {
  const idx = (name: string) => headers.indexOf(name);
  const iId = idx("TransferWise ID");
  const iDate = idx("Date");
  const iAmount = idx("Amount");
  const iCurrency = idx("Currency");
  const iDescription = idx("Description");
  const iReference = idx("Payment Reference");
  const iMerchant = idx("Merchant");
  const iPayeeName = idx("Payee Name");
  const iPayerName = idx("Payer Name");

  const parsed: ParsedRow[] = [];
  const rowErrors: string[] = [];

  rows.forEach((row, i) => {
    if (row.length <= 1 && !row[0]) return; // trailing blank line
    const bookedAt = row[iDate] ? parseWiseDate(row[iDate]) : null;
    const amount = row[iAmount] ? parseAmount(row[iAmount]) : null;
    const currency = row[iCurrency]?.trim();

    if (!bookedAt || amount === null || !currency) {
      rowErrors.push(`Row ${i + 2}: could not read date/amount/currency, skipped.`);
      return;
    }

    const description = row[iDescription]?.trim() || "";
    const reference = iReference >= 0 ? row[iReference]?.trim() : "";
    const rawDescription = reference ? `${description} - ${reference}` : description;
    const merchantName =
      (iMerchant >= 0 && row[iMerchant]?.trim()) ||
      (iPayeeName >= 0 && row[iPayeeName]?.trim()) ||
      (iPayerName >= 0 && row[iPayerName]?.trim()) ||
      null;
    const csvId = iId >= 0 ? row[iId]?.trim() : "";
    const externalId = csvId || hashExternalId(["wise", bookedAt, String(amount), currency, rawDescription]);

    parsed.push({ externalId, bookedAt, amount, currency, rawDescription, merchantName });
  });

  return { parsed, rowErrors };
}

function rowsFromPayPalCsv(headers: string[], rows: string[][]): { parsed: ParsedRow[]; rowErrors: string[] } {
  // PayPal ships the same data under different column names depending on account locale/report
  // type — the English "Activity" export vs. the German "Kontoauszug" (CSR) export.
  const idx = (...names: string[]) => {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iId = idx("Transaction ID", "Transaktionscode");
  const iDate = idx("Date", "Datum");
  const iTime = idx("Time", "Uhrzeit");
  const iType = idx("Type", "Beschreibung");
  const iCurrency = idx("Currency", "Währung");
  const iNet = idx("Net", "Netto");
  const iGross = idx("Gross", "Brutto");
  const iName = idx("Name");
  const iItemTitle = idx("Item Title");
  const iSubject = idx("Subject");
  const iNote = idx("Note");
  const iInvoice = idx("Rechnungsnummer");

  const parsed: ParsedRow[] = [];
  const rowErrors: string[] = [];

  rows.forEach((row, i) => {
    if (row.length <= 1 && !row[0]) return;
    const bookedAt = row[iDate] ? parsePayPalDate(row[iDate], iTime >= 0 ? row[iTime] : undefined) : null;
    // Net (amount actually hitting the balance, after fees) rather than Gross — this
    // schema has no separate fee column, so Net is the value that matches reality.
    const amountRaw = (iNet >= 0 && row[iNet]) || row[iGross];
    const amount = amountRaw ? parseAmount(amountRaw) : null;
    const currency = row[iCurrency]?.trim();

    if (!bookedAt || amount === null || !currency) {
      rowErrors.push(`Row ${i + 2}: could not read date/amount/currency, skipped.`);
      return;
    }

    const type = row[iType]?.trim() || "";
    const detail =
      (iItemTitle >= 0 && row[iItemTitle]?.trim()) ||
      (iSubject >= 0 && row[iSubject]?.trim()) ||
      (iNote >= 0 && row[iNote]?.trim()) ||
      (iInvoice >= 0 && row[iInvoice]?.trim()) ||
      "";
    const rawDescription = detail ? `${type} - ${detail}` : type;
    const merchantName = (iName >= 0 && row[iName]?.trim()) || null;
    const csvId = iId >= 0 ? row[iId]?.trim() : "";
    const externalId = csvId || hashExternalId(["paypal", bookedAt, String(amount), currency, rawDescription]);

    parsed.push({ externalId, bookedAt, amount, currency, rawDescription, merchantName });
  });

  return { parsed, rowErrors };
}

function rowsFromSparkasseCsv(headers: string[], rows: string[][]): { parsed: ParsedRow[]; rowErrors: string[] } {
  const idx = (name: string) => headers.indexOf(name);
  const iDate = idx("Buchungstag");
  const iAmount = idx("Betrag");
  const iCurrency = idx("Waehrung");
  const iBuchungstext = idx("Buchungstext");
  const iVerwendungszweck = idx("Verwendungszweck");
  const iBeguenstigter = idx("Beguenstigter/Zahlungspflichtiger");
  const iEndToEndRef = idx("Kundenreferenz (End-to-End)");

  const parsed: ParsedRow[] = [];
  const rowErrors: string[] = [];

  rows.forEach((row, i) => {
    if (row.length <= 1 && !row[0]) return; // trailing blank line
    const bookedAt = row[iDate] ? parseSparkasseDate(row[iDate]) : null;
    const amount = row[iAmount] ? parseAmount(row[iAmount]) : null;
    const currency = row[iCurrency]?.trim();

    if (!bookedAt || amount === null || !currency) {
      rowErrors.push(`Row ${i + 2}: could not read date/amount/currency, skipped.`);
      return;
    }

    const buchungstext = row[iBuchungstext]?.trim() || "";
    const verwendungszweck = row[iVerwendungszweck]?.trim() || "";
    const rawDescription = verwendungszweck ? `${buchungstext} - ${verwendungszweck}` : buchungstext;
    const merchantName = (iBeguenstigter >= 0 && row[iBeguenstigter]?.trim()) || null;
    const endToEndRef = iEndToEndRef >= 0 ? row[iEndToEndRef]?.trim() : "";
    // Sparkasse's export has no transaction ID column, unlike Wise/PayPal — fall back to
    // the end-to-end reference when present, otherwise hash the row's content.
    const externalId =
      endToEndRef || hashExternalId(["sparkasse", bookedAt, String(amount), currency, rawDescription]);

    parsed.push({ externalId, bookedAt, amount, currency, rawDescription, merchantName });
  });

  return { parsed, rowErrors };
}

const accountCache = new Map<string, string>();

async function ensureAccount(client: SupabaseClient<Database>, provider: Provider, currency: string): Promise<string> {
  const cacheKey = `${provider}:${currency}`;
  const cached = accountCache.get(cacheKey);
  if (cached) return cached;

  // Prefixed "csv-" so this never collides with the Enable Banking integration's accounts
  // for the same provider (external_account_id "eb-{provider}-{uid}", see enableBankingSync.ts)
  // — they're always distinct account rows. Known risk if both are active for the same
  // provider at once: real-world transactions can show up twice (once per account row),
  // since there's no cross-source dedup — only within-account dedup via the
  // (account_id, external_id) unique constraint.
  const externalAccountId = `csv-${provider}-${currency}`;
  const { data: existing } = await client
    .from("accounts")
    .select("id")
    .eq("provider", provider)
    .eq("external_account_id", externalAccountId)
    .maybeSingle();

  if (existing?.id) {
    accountCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const { data: created, error } = await client
    .from("accounts")
    .insert({
      provider,
      name: `${PROVIDER_LABELS[provider]} (CSV-Import, ${currency})`,
      currency,
      account_type: "bank",
      external_account_id: externalAccountId,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Account for ${PROVIDER_LABELS[provider]} (${currency}) could not be created: ${error?.message}`);
  }
  accountCache.set(cacheKey, created.id);
  return created.id;
}

export async function runCsvImport(client: SupabaseClient<Database>): Promise<CsvImportResult> {
  const errors: string[] = [];
  let filesProcessed = 0;
  let imported = 0;
  let skipped = 0;

  await fs.mkdir(IMPORTS_DIR, { recursive: true });
  await fs.mkdir(PROCESSED_DIR, { recursive: true });

  const entries = await fs.readdir(IMPORTS_DIR, { withFileTypes: true });
  const fileNames = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".csv")).map((e) => e.name);
  const activeEbProviders = await getActiveEnableBankingProviders(client);

  for (const fileName of fileNames) {
    const filePath = path.join(IMPORTS_DIR, fileName);
    try {
      const buf = await fs.readFile(filePath);
      const text = decodeCsvBuffer(buf).trim();
      const delimiter = sniffDelimiter(text);
      const allRows = parseCsv(text, delimiter).filter((r) => r.length > 1 || r[0] !== "");

      if (allRows.length < 2) {
        errors.push(`${fileName}: File is empty or has no data rows. Left in imports/.`);
        skipped++;
        continue;
      }

      const [headerRow, ...dataRows] = allRows;

      if (isPayPalReconciliationReport(headerRow)) {
        errors.push(
          `${fileName}: This is a PayPal "Balance Reconciliation Report" (business account report), not an Activity CSV export — this format is not supported and contains 0 entries anyway. Please export the activity/transaction history instead (columns like Transaction ID, Date, Type, Currency, Gross, Net). Left in imports/ — please check manually.`
        );
        skipped++;
        continue;
      }

      const format = detectFormat(headerRow);
      if (!format) {
        errors.push(
          `${fileName}: Format not recognized (no Wise, PayPal, or Sparkasse CSV header found). Left in imports/ — please check manually.`
        );
        skipped++;
        continue;
      }

      if (activeEbProviders.has(format)) {
        errors.push(
          `${fileName}: ${PROVIDER_LABELS[format]} is currently running via Enable Banking (active connection) — CSV fallback for this provider is paused to avoid duplicate transactions. The file stays unchanged in imports/ and will be processed automatically once the Enable Banking connection expires.`
        );
        skipped++;
        continue;
      }

      const { parsed, rowErrors } =
        format === "wise"
          ? rowsFromWiseCsv(headerRow, dataRows)
          : format === "paypal"
            ? rowsFromPayPalCsv(headerRow, dataRows)
            : rowsFromSparkasseCsv(headerRow, dataRows);
      errors.push(...rowErrors.map((e) => `${fileName}: ${e}`));

      if (parsed.length === 0) {
        errors.push(`${fileName}: No valid rows found. Left in imports/.`);
        skipped++;
        continue;
      }

      const byCurrency = new Map<string, ParsedRow[]>();
      for (const row of parsed) {
        const list = byCurrency.get(row.currency) ?? [];
        list.push(row);
        byCurrency.set(row.currency, list);
      }

      let fileImported = 0;
      for (const [currency, currencyRows] of byCurrency) {
        const accountId = await ensureAccount(client, format, currency);
        const dbRows = currencyRows.map((r) => ({
          account_id: accountId,
          external_id: r.externalId,
          booked_at: r.bookedAt,
          amount: r.amount,
          currency: r.currency,
          raw_description: r.rawDescription,
          merchant_name: r.merchantName,
        }));

        const { data: insertedRows, error: insertError } = await client
          .from("transactions")
          .upsert(dbRows, { onConflict: "account_id,external_id", ignoreDuplicates: true })
          .select("id, mcc, merchant_name, raw_description, category_id");

        if (insertError) {
          throw new Error(`Transaktionen (${currency}) konnten nicht gespeichert werden: ${insertError.message}`);
        }

        fileImported += insertedRows?.length ?? 0;

        for (const row of insertedRows ?? []) {
          if (row.category_id) continue;
          try {
            const result = await categorizeTransaction(client, {
              mcc: row.mcc,
              merchant_name: row.merchant_name,
              raw_description: row.raw_description,
            });
            await client.from("transactions").update(result).eq("id", row.id);
          } catch (err) {
            errors.push(`${fileName}: Categorization failed for transaction ${row.id} (${(err as Error).message})`);
          }
        }
      }

      imported += fileImported;
      filesProcessed++;

      // Encode the timestamp (epoch ms, trivially filename-safe and sortable) and the
      // imported count into the filename so the "recently processed" UI list can show
      // both without needing a separate manifest/table.
      const destName = `${Date.now()}__${fileImported}tx__${fileName}`;
      await fs.rename(filePath, path.join(PROCESSED_DIR, destName));
    } catch (err) {
      errors.push(`${fileName}: ${(err as Error).message}`);
      skipped++;
    }
  }

  return { filesProcessed, imported, skipped, errors };
}

export type ProcessedFileInfo = {
  fileName: string;
  processedAt: string | null;
  imported: number | null;
};

export async function listProcessedFiles(limit = 10): Promise<ProcessedFileInfo[]> {
  await fs.mkdir(PROCESSED_DIR, { recursive: true });
  const entries = await fs.readdir(PROCESSED_DIR, { withFileTypes: true });
  const fileNames = entries.filter((e) => e.isFile() && e.name !== ".gitkeep").map((e) => e.name);

  const parsed = fileNames.map((name): ProcessedFileInfo & { sortKey: number } => {
    const firstSplit = name.indexOf("__");
    const secondSplit = firstSplit >= 0 ? name.indexOf("__", firstSplit + 2) : -1;
    if (firstSplit < 0 || secondSplit < 0) {
      return { fileName: name, processedAt: null, imported: null, sortKey: 0 };
    }
    const tsPart = name.slice(0, firstSplit);
    const countPart = name.slice(firstSplit + 2, secondSplit);
    const originalName = name.slice(secondSplit + 2);
    const countMatch = countPart.match(/^(\d+)tx$/);
    const epochMs = Number(tsPart);
    const processedAt = Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;

    return {
      fileName: originalName,
      processedAt,
      imported: countMatch ? Number(countMatch[1]) : null,
      sortKey: Number.isFinite(epochMs) ? epochMs : 0,
    };
  });

  parsed.sort((a, b) => b.sortKey - a.sortKey);
  return parsed.slice(0, limit).map((f) => ({ fileName: f.fileName, processedAt: f.processedAt, imported: f.imported }));
}
