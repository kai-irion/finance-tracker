"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivacy } from "@/lib/privacy-context";
import { isDemoMode } from "@/lib/demo-mode";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/review", label: "Review" },
  { href: "/analysis", label: "Analysis" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ onSignOut }: { onSignOut?: () => void } = {}) {
  const pathname = usePathname();
  const { isPrivate, togglePrivate } = usePrivacy();

  return (
    <aside className="w-56 shrink-0 border-r border-divider min-h-screen p-4 flex flex-col">
      <div className="flex items-center justify-between mb-6 px-2">
        <div className="nav-brand text-lg">FinanceHub</div>
        {isDemoMode() && (
          <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-medium text-accent-700">
            Demo
          </span>
        )}        <button
          onClick={togglePrivate}
          title={isPrivate ? "Privacy mode on — click to show amounts" : "Privacy mode off — click to hide amounts"}
          className={`rounded-md p-1.5 ${
            isPrivate ? "bg-accent-100 text-accent-700" : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          {isPrivate ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.092a4 4 0 00-5.557-5.557z" />
              <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
              <path
                fillRule="evenodd"
                d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-2 rounded-md text-sm transition-colors border-l-2 ${
                isActive
                  ? "border-accent text-accent font-medium bg-accent-100/60"
                  : "border-transparent hover:bg-neutral-100 text-neutral-700"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {onSignOut && (
        <button
          onClick={onSignOut}
          className="mt-auto px-3 py-2 rounded-md text-sm text-left text-muted hover:bg-neutral-100"
        >
          Sign out
        </button>
      )}
    </aside>
  );
}
