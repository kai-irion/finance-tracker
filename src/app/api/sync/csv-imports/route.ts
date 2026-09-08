import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { listProcessedFiles, runCsvImport } from "@/lib/importCsv";
import { matchInternalTransfers } from "@/lib/matchInternalTransfers";
import { recordDailySnapshotIfNeeded } from "@/lib/balanceSnapshots";

export async function POST() {
  if (isDemoMode()) return NextResponse.json({ synced: 0, errors: ["Disabled in this public demo."] }, { status: 403 });
  try {
    const result = await runCsvImport(supabaseAdmin);

    const status =
      result.errors.length === 0 ? "success" : result.filesProcessed > 0 ? "partial" : "error";

    await supabaseAdmin.from("sync_log").insert({
      provider: "csv-import",
      status,
      message: result.errors.length > 0 ? result.errors.join("; ") : null,
      transactions_synced: result.imported,
    });

    try {
      await matchInternalTransfers(supabaseAdmin);
    } catch (err) {
      result.errors.push(`Internal transfer matching failed: ${(err as Error).message}`);
    }
    try {
      await recordDailySnapshotIfNeeded(supabaseAdmin);
    } catch (err) {
      result.errors.push(`Balance snapshot failed: ${(err as Error).message}`);
    }

    return NextResponse.json({
      synced: result.imported,
      errors: result.errors,
      filesProcessed: result.filesProcessed,
      skipped: result.skipped,
    });
  } catch (err) {
    const message = `CSV import failed: ${(err as Error).message}`;
    await supabaseAdmin.from("sync_log").insert({
      provider: "csv-import",
      status: "error",
      message,
      transactions_synced: 0,
    });
    return NextResponse.json({ synced: 0, errors: [message] }, { status: 500 });
  }
}

export async function GET() {
  if (isDemoMode()) return NextResponse.json({ files: [] });
  try {
    const files = await listProcessedFiles(10);
    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json({ files: [], error: (err as Error).message }, { status: 500 });
  }
}
