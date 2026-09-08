"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/transactions", label: "Transactions", icon: "↔" },
  { href: "/analysis", label: "Analysis", icon: "◐" },
  { href: "/accounts", label: "Accounts", icon: "▤" },
  { href: "/categories", label: "Categories", icon: "◫" },
  { href: "/rules", label: "Rules", icon: "⚙" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function AnalysisSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[220px] shrink-0 border-r border-border bg-surface px-3 py-6 font-sans">
      <div className="flex items-center gap-2 px-3 pb-6 text-lg font-bold text-ink">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
        FinanceHub
      </div>
      <nav aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`relative mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive ? "bg-accent-soft font-semibold text-accent" : "text-ink-soft hover:text-ink"
              }`}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r-[3px] bg-accent"
                />
              )}
              <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center text-[13px]">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
