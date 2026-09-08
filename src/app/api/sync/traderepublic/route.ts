import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo-mode";
import { supabaseAdmin } from "@/lib/supabase/admin-client";

const execFileAsync = promisify(execFile);
const PYTHON_SYNC_DIR = path.join(process.cwd(), "python-sync");
const PYTHON_BIN = path.join(PYTHON_SYNC_DIR, ".venv", "bin", "python");
const SCRIPT_PATH = path.join(PYTHON_SYNC_DIR, "sync_traderepublic.py");
// The script itself gives up after ~2 minutes if it needs an unattended 2FA confirmation
// (see python-sync/README.md) — this just needs to outlast that plus normal sync time.
const TIMEOUT_MS = 150_000;

// Runs the standalone TradeRepublic sync script as a child process — no arguments are ever
// passed to it (fixed path, execFile not exec, so there's no shell/command injection surface)
// and it only exists to let the "Sync now" button on /accounts trigger it, since it otherwise
// requires a manual terminal run. First run (or after the cached session expires) still needs
// a manual push-notification confirmation in the TradeRepublic app; if that doesn't happen in
// time the script exits with a clear error, which surfaces below via sync_log.
export async function POST() {
  if (isDemoMode()) return NextResponse.json({ synced: 0, errors: ["Disabled in this public demo."] }, { status: 403 });
  const startedAt = new Date().toISOString();
  let processError: string | null = null;

  try {
    await execFileAsync(PYTHON_BIN, [SCRIPT_PATH], { cwd: PYTHON_SYNC_DIR, timeout: TIMEOUT_MS });
  } catch (err) {
    processError = (err as Error).message;
  }

  const { data: latest } = await supabaseAdmin
    .from("sync_log")
    .select("status, message, transactions_synced, synced_at")
    .eq("provider", "traderepublic")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest || latest.synced_at < startedAt) {
    return NextResponse.json(
      {
        synced: 0,
        errors: [
          processError
            ? `TradeRepublic sync script failed to run: ${processError}. Is python-sync/.venv set up? See python-sync/README.md.`
            : "TradeRepublic sync ran but wrote no new sync_log entry.",
        ],
      },
      { status: 500 }
    );
  }

  const errors = latest.status === "error" || latest.status === "partial" ? [latest.message ?? "Unknown error."] : [];
  return NextResponse.json({ synced: latest.transactions_synced, errors }, { status: latest.status === "error" ? 502 : 200 });
}
