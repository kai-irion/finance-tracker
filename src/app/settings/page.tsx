"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountsPanel } from "@/components/settings/accounts-panel";
import { CategoriesPanel } from "@/components/settings/categories-panel";
import { RulesPanel } from "@/components/settings/rules-panel";
import { ApiKeyPanel } from "@/components/settings/api-key-panel";
import { isDemoMode } from "@/lib/demo-mode";

type Tab = "accounts" | "categories" | "rules" | "api-key";

const ALL_TABS: { key: Tab; label: string }[] = [
  { key: "accounts", label: "Accounts" },
  { key: "categories", label: "Categories" },
  { key: "rules", label: "Rules" },
  { key: "api-key", label: "API key" },
];

// Demo has no private API keys — the API key tab (OpenRouter/Google Maps) is hidden.
const TABS = isDemoMode() ? ALL_TABS.filter((t) => t.key !== "api-key") : ALL_TABS;

function isTab(value: string | null): value is Tab {
  return TABS.some((t) => t.key === value);
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(isTab(requestedTab) ? requestedTab : "accounts");

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>

      <div className="flex gap-2 mb-6 border-b border-divider">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.key ? "border-accent text-accent" : "border-transparent text-neutral-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "accounts" && <AccountsPanel />}
      {tab === "categories" && <CategoriesPanel />}
      {tab === "rules" && <RulesPanel />}
      {tab === "api-key" && <ApiKeyPanel />}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
      <SettingsContent />
    </Suspense>
  );
}
