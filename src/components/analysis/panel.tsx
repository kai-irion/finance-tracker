import type { ReactNode } from "react";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-surface p-6 font-sans">
      {/* Plain div (not h2): components.css's unlayered heading rules would override utilities. */}
      <div className="mb-[18px] text-[15px] font-semibold text-ink">{title}</div>
      {children}
    </section>
  );
}
