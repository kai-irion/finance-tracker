// Demo mode (FinanceHub-demo only): when NEXT_PUBLIC_DEMO_MODE=true the app runs
// without login against a seeded demo database. Auth gate is bypassed, bank
// sync/connect UI is hidden, and AI features (which need private API keys) are
// hidden — everything else works against the dummy data.
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

export const DEMO_SYNC_NOTE = "Demo data — bank sync is disabled in this public demo.";
export const DEMO_AI_NOTE = "AI features need a private API key and are disabled in this public demo.";
export const DEMO_CONNECT_NOTE =
  "Connecting real bank accounts is disabled in this public demo — it runs on fixed dummy data.";
