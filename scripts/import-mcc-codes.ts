import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

config({ path: ".env.local" });

const MCC_CSV_URL =
  "https://raw.githubusercontent.com/greggles/mcc-codes/main/mcc_codes.csv";
const BATCH_SIZE = 500;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check .env.local."
  );
}

const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Minimal RFC4180 CSV line splitter (handles quoted fields with commas).
function parseCsv(text: string): string[][] {
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
    } else if (char === ",") {
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

async function main() {
  console.log(`Downloading MCC codes from ${MCC_CSV_URL} ...`);
  const res = await fetch(MCC_CSV_URL);
  if (!res.ok) {
    throw new Error(`Failed to download MCC CSV: ${res.status} ${res.statusText}`);
  }
  const csvText = await res.text();

  const rows = parseCsv(csvText.trim());
  const [header, ...dataRows] = rows;
  const mccIdx = header.indexOf("mcc");
  const descIdx = header.indexOf("combined_description");

  if (mccIdx === -1 || descIdx === -1) {
    throw new Error(
      `Unexpected CSV header: ${header.join(", ")}. Expected "mcc" and "combined_description" columns.`
    );
  }

  const records = dataRows
    .filter((r) => r[mccIdx])
    .map((r) => ({
      mcc: r[mccIdx].trim(),
      description: r[descIdx]?.trim() || null,
      default_category_id: null,
    }));

  console.log(`Parsed ${records.length} MCC codes. Importing in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("mcc_codes").upsert(batch, { onConflict: "mcc" });
    if (error) {
      throw new Error(`Failed to import batch starting at index ${i}: ${error.message}`);
    }
    console.log(`Imported ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
