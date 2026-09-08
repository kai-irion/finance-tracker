"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import { EmojiPickerButton } from "@/components/emoji-picker-button";
import type { Category } from "@/lib/supabase/types";

type PendingDelete = { category: Category; transactionCount: number };

// TODO(stretch): per-category monthly budget limits + progress bar for the current month.
export function CategoriesPanel() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [isIncome, setIsIncome] = useState(false);
  const [isRecurring, setIsRecurring] = useState(true);

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [suggestingEmojis, setSuggestingEmojis] = useState(false);
  const [emojiError, setEmojiError] = useState<string | null>(null);

  async function loadCategories() {
    setLoading(true);
    const { data, error } = await supabase.from("categories").select("*").order("name");
    if (error) {
      setError(error.message);
    } else {
      setCategories(data ?? []);
      setError(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadCategories();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const trimmedIcon = icon.trim();
    const { data: created, error } = await supabase
      .from("categories")
      .insert({
        name: name.trim(),
        icon: trimmedIcon || null,
        is_income: isIncome,
        is_recurring: isRecurring,
      })
      .select("id")
      .single();
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setName("");
    setIcon("");
    setIsIncome(false);
    setIsRecurring(true);
    setShowForm(false);
    await loadCategories();

    // Auto-suggest an emoji only if the user didn't pick one themselves.
    if (!trimmedIcon && created) {
      suggestEmojis([created.id]);
    }
  }

  async function suggestEmojis(categoryIds: string[]) {
    setSuggestingEmojis(true);
    setEmojiError(null);
    try {
      const res = await fetch("/api/categories/suggest-emoji", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds }),
      });
      const data: { updated: number; errors: string[] } = await res.json();
      if (data.errors.length > 0) setEmojiError(data.errors.join(" "));
      await loadCategories();
    } catch (err) {
      setEmojiError(err instanceof Error ? err.message : "Emoji suggestion failed.");
    } finally {
      setSuggestingEmojis(false);
    }
  }

  function startRename(category: Category) {
    setRenamingId(category.id);
    setRenameValue(category.name);
  }

  async function saveRename(category: Category) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === category.name) return;
    setCategories((prev) => prev.map((c) => (c.id === category.id ? { ...c, name: trimmed } : c)));
    await supabase.from("categories").update({ name: trimmed }).eq("id", category.id);
  }

  async function changeIcon(category: Category, emoji: string) {
    setCategories((prev) => prev.map((c) => (c.id === category.id ? { ...c, icon: emoji } : c)));
    await supabase.from("categories").update({ icon: emoji }).eq("id", category.id);
  }

  async function toggleField(category: Category, field: "is_recurring" | "is_income") {
    const update: Partial<Category> = { [field]: !category[field] };
    const { error } = await supabase.from("categories").update(update).eq("id", category.id);
    if (error) {
      setError(error.message);
      return;
    }
    setCategories((prev) => prev.map((c) => (c.id === category.id ? { ...c, [field]: !c[field] } : c)));
  }

  async function requestDelete(category: Category) {
    const { count, error } = await supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("category_id", category.id);
    if (error) {
      setError(error.message);
      return;
    }
    setPendingDelete({ category, transactionCount: count ?? 0 });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const { error } = await supabase.from("categories").delete().eq("id", pendingDelete.category.id);
    setDeleting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setPendingDelete(null);
    loadCategories();
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-end mb-6 gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => suggestEmojis(categories.filter((c) => !c.icon).map((c) => c.id))}
            disabled={suggestingEmojis || categories.every((c) => c.icon)}
            className="btn btn-secondary"
          >
            {suggestingEmojis ? "Suggesting…" : "Suggest emojis"}
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="btn btn-primary"
          >
            {showForm ? "Cancel" : "Add category"}
          </button>
        </div>
      </div>

      {emojiError && <p className="text-sm text-accent-700 mb-4">{emojiError}</p>}

      <p className="text-sm text-muted mb-6">
        Recurring categories are ongoing expense types (groceries, subscriptions). Mark a
        category as one-time for things like fines, deposits, or large one-off purchases.
      </p>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 card p-4 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pet Care"
              required
              className="input"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Icon (optional)</label>
            <div className="flex items-center gap-2">
              <EmojiPickerButton value={icon || null} onChange={setIcon} />
              {icon && (
                <button
                  type="button"
                  onClick={() => setIcon("")}
                  className="text-xs text-neutral-500 hover:underline"
                >
                  Clear
                </button>
              )}
              {!icon && (
                <span className="text-xs text-neutral-500">
                  Leave empty to auto-suggest one after saving.
                </span>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isIncome} onChange={(e) => setIsIncome(e.target.checked)} />
            Income category
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
            Recurring
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="self-start btn btn-primary"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {loading && <p className="text-sm text-muted">Loading…</p>}
      {error && <p className="text-sm text-danger mb-3">Error: {error}</p>}

      {!loading && (
        <div className="flex flex-col gap-2">
          {categories.map((c) => (
            <div key={c.id} className="card p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <EmojiPickerButton size="sm" placeholder="＋" value={c.icon} onChange={(emoji) => changeIcon(c, emoji)} />
                  {renamingId === c.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(c);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="input py-0.5 text-sm font-medium"
                    />
                  ) : (
                    <button
                      onClick={() => startRename(c)}
                      className="font-medium text-sm truncate text-left hover:underline decoration-dotted"
                      title="Rename"
                    >
                      {c.name}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" checked={c.is_income} onChange={() => toggleField(c, "is_income")} />
                    Income
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={c.is_recurring}
                      onChange={() => toggleField(c, "is_recurring")}
                    />
                    Recurring
                  </label>
                  <button
                    onClick={() => requestDelete(c)}
                    className="text-xs text-danger hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {pendingDelete?.category.id === c.id && (
                <div className="mt-3 rounded-md border border-accent-300 bg-accent-100 p-3 text-sm">
                  {pendingDelete.transactionCount > 0 ? (
                    <p className="mb-2">
                      {pendingDelete.transactionCount} transaction{pendingDelete.transactionCount === 1 ? "" : "s"}{" "}
                      use this category. Deleting it will leave{" "}
                      {pendingDelete.transactionCount === 1 ? "that transaction" : "those transactions"}{" "}
                      uncategorized. Consider recategorizing them first on the Transactions page, or keep this
                      category instead.
                    </p>
                  ) : (
                    <p className="mb-2">Delete &quot;{c.name}&quot;? No transactions use it.</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={confirmDelete}
                      disabled={deleting}
                      className="btn btn-danger"
                    >
                      {deleting ? "Deleting…" : "Delete anyway"}
                    </button>
                    <button
                      onClick={() => setPendingDelete(null)}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {categories.length === 0 && <p className="text-sm text-neutral-500">No categories yet.</p>}
        </div>
      )}
    </div>
  );
}
