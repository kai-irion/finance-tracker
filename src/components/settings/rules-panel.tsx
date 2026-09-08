"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import type { Category, MerchantRule } from "@/lib/supabase/types";

type RuleRow = MerchantRule & { categories: { name: string } | null };

export function RulesPanel() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");

  async function loadData() {
    setLoading(true);
    const [rulesRes, catRes] = await Promise.all([
      supabase
        .from("merchant_rules")
        .select("*, categories(name)")
        .order("created_at", { ascending: false }),
      supabase.from("categories").select("*").order("name"),
    ]);

    if (rulesRes.error) {
      setError(rulesRes.error.message);
    } else {
      setRules((rulesRes.data ?? []) as unknown as RuleRow[]);
      setError(null);
    }
    const cats = catRes.data ?? [];
    setCategories(cats);
    if (cats.length > 0) setCategoryId((prev) => prev || cats[0].id);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pattern.trim() || !categoryId) return;
    setSubmitting(true);
    const { error } = await supabase.from("merchant_rules").insert({
      pattern: pattern.trim(),
      category_id: categoryId,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setPattern("");
    setShowForm(false);
    loadData();
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-end mb-6">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn btn-primary"
        >
          {showForm ? "Cancel" : "Add rule"}
        </button>
      </div>

      <p className="text-sm text-muted mb-6">
        Merchant rules automatically assign a category to transactions based on a text pattern.
      </p>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 card p-4 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Pattern</label>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. REWE, AMAZON, NETFLIX"
              required
              className="input"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Category</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="input"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting || categories.length === 0}
              className="btn btn-primary"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPattern("");
                setShowForm(false);
              }}
              className="btn btn-secondary"
            >
              Discard
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-danger mb-3">Error: {error}</p>}

      {!loading && (
        <div className="flex flex-col gap-2">
          {rules.map((r) => (
            <div
              key={r.id}
              className="card p-3 flex items-center justify-between"
            >
              <span className="font-mono text-sm">{r.pattern}</span>
              <span className="text-xs text-muted">
                {r.categories?.name ?? "—"}
              </span>
            </div>
          ))}
          {rules.length === 0 && (
            <p className="text-sm text-neutral-500">No rules yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
