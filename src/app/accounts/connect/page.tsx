"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { DEMO_CONNECT_NOTE, isDemoMode } from "@/lib/demo-mode";
import { ENABLE_BANKING_PROVIDER_KEYS, ENABLE_BANKING_PROVIDERS, type EnableBankingProviderKey } from "@/lib/enableBankingProviders";
import type { EnableBankingSession } from "@/lib/supabase/types";

function ConnectContent() {
  const searchParams = useSearchParams();
  const [connectingProvider, setConnectingProvider] = useState<EnableBankingProviderKey | null>(null);
  const [error, setError] = useState<string | null>(searchParams.get("error"));
  const [message, setMessage] = useState<string | null>(searchParams.get("message"));
  const [sessions, setSessions] = useState<Record<string, EnableBankingSession>>({});
  const [ebAccountCounts, setEbAccountCounts] = useState<Record<string, number>>({});
  const [loadingSessions, setLoadingSessions] = useState(true);

  async function loadSessions() {
    setLoadingSessions(true);
    const { data } = await supabase
      .from("enable_banking_sessions")
      .select("*")
      .in("provider", ENABLE_BANKING_PROVIDER_KEYS);
    const byProvider: Record<string, EnableBankingSession> = {};
    for (const row of data ?? []) byProvider[row.provider] = row;
    setSessions(byProvider);
    setLoadingSessions(false);
  }

  // A session can be "AUTHORIZED" at Enable Banking while the ASPSP still handed over zero
  // accounts (e.g. the bank's own account-selection step wasn't completed) — a valid
  // session alone doesn't mean any account data actually exists. Counting real
  // eb-{provider}-* account rows here so the badge below can distinguish "connected and
  // working" from "authorized but nothing to sync" instead of showing a misleading
  // green checkmark either way.
  async function loadEbAccountCounts() {
    const { data } = await supabase
      .from("accounts")
      .select("provider, external_account_id")
      .in("provider", ENABLE_BANKING_PROVIDER_KEYS);
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      if (row.external_account_id?.startsWith(`eb-${row.provider}-`)) {
        counts[row.provider] = (counts[row.provider] ?? 0) + 1;
      }
    }
    setEbAccountCounts(counts);
  }

  useEffect(() => {
    loadSessions();
    loadEbAccountCounts();
  }, []);

  async function handleConnect(provider: EnableBankingProviderKey) {
    setConnectingProvider(provider);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/enable-banking/start-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data: { url?: string; error?: string } = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Failed to start consent.");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
      setConnectingProvider(null);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">Connect bank accounts</h1>
      {isDemoMode() && (
        <p className="text-sm text-accent-700 mb-4 rounded-md bg-accent-100 p-3">{DEMO_CONNECT_NOTE}</p>
      )}
      <p className="text-sm text-muted mb-6">
        Runs via Enable Banking (PSD2 open banking aggregator). Connecting redirects you to the
        respective provider, where you log in and confirm access. Access is then valid for 90
        days (PSD2 standard) — sync runs automatically during that time via &quot;Sync now&quot;
        or &quot;Sync all accounts&quot;. After it expires, the connection step needs to be
        repeated once — each provider has its own consent, independent of the others.
      </p>

      {message && (
        <p className="text-sm text-success mb-4 rounded-md bg-success-100 p-3">
          {message}
        </p>
      )}
      {error && (
        <p className="text-sm text-danger mb-4 rounded-md bg-danger-100 p-3">{error}</p>
      )}

      <div className="flex flex-col gap-3">
        {ENABLE_BANKING_PROVIDER_KEYS.map((key) => {
          const config = ENABLE_BANKING_PROVIDERS[key];
          const session = sessions[key];
          const isExpired = session ? new Date(session.expires_at).getTime() < Date.now() : false;
          const accountCount = ebAccountCounts[key] ?? 0;
          const hasZeroAccounts = !!session && !isExpired && accountCount === 0;
          const isFullyConnected = !!session && !isExpired && accountCount > 0;
          const isConnecting = connectingProvider === key;

          let statusText = "Not connected";
          if (session) {
            if (isExpired) statusText = "Connection expired";
            else if (hasZeroAccounts) {
              statusText = "Authorized, but 0 accounts transferred — check the Enable Banking control panel";
            } else {
              statusText = `Connected until ${new Date(session.expires_at).toLocaleDateString("en-US")} · ${accountCount} account${accountCount === 1 ? "" : "s"}`;
            }
          }

          return (
            <div
              key={key}
              className="card p-4 flex items-center justify-between gap-4"
            >
              <div>
                <div className="font-medium text-sm">{config.label}</div>
                {!loadingSessions && (
                  <div
                    className={`text-xs mt-0.5 ${
                      hasZeroAccounts ? "text-accent-700" : "text-muted"
                    }`}
                  >
                    {statusText}
                  </div>
                )}
              </div>
              {isFullyConnected ? (
                <span className="shrink-0 rounded-md bg-neutral-100 text-neutral-400 px-3 py-1.5 text-sm font-medium flex items-center gap-1.5">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path
                      fillRule="evenodd"
                      d="M16.704 5.29a1 1 0 010 1.415l-7.404 7.404a1 1 0 01-1.415 0L3.296 9.52a1 1 0 111.415-1.414l3.774 3.774 6.697-6.697a1 1 0 011.415 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Connected
                </span>
              ) : (
                <button
                  onClick={() => handleConnect(key)}
                  disabled={connectingProvider !== null}
                  className={`shrink-0 btn ${hasZeroAccounts ? "btn-secondary" : "btn-primary"}`}
                >
                  {isConnecting
                    ? "Redirecting…"
                    : hasZeroAccounts
                      ? `Reconnect ${config.label}`
                      : `Connect ${config.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl">Loading…</div>}>
      <ConnectContent />
    </Suspense>
  );
}
