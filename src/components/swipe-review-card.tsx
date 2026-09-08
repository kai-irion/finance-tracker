"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatMoney } from "@/lib/formatMoney";
import type { Category } from "@/lib/supabase/types";

export type ReviewTransaction = {
  id: string;
  merchant_name: string | null;
  raw_description: string | null;
  amount: number;
  currency: string;
  booked_at: string;
  accountLabel: string;
};

const SWIPE_THRESHOLD = 120;
const EXIT_DISTANCE = 600;
const EXIT_MS = 180;

// One card in the /review swipe stack. Only the top card (active=true) responds to drag —
// pointer events are used (not touch/mouse separately) so the same handlers work for mouse,
// touch, and pen. Dragging past SWIPE_THRESHOLD in either direction commits the swipe (right =
// accept the category currently selected in the dropdown, left = skip); short drags spring
// back to center. The category dropdown and Accept/Skip buttons call e.stopPropagation() on
// pointer-down so interacting with them doesn't also start a card drag.
export function SwipeReviewCard({
  transaction,
  categories,
  categoryId,
  suggestedCategoryId,
  suggestionPending = false,
  onCategoryChange,
  onAccept,
  onSkip,
  active,
  stackIndex,
  isPrivate,
}: {
  transaction: ReviewTransaction;
  categories: Category[];
  categoryId: string;
  suggestedCategoryId: string | null;
  suggestionPending?: boolean;
  onCategoryChange: (categoryId: string) => void;
  onAccept: () => void;
  onSkip: () => void;
  active: boolean;
  stackIndex: number;
  isPrivate: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exiting, setExiting] = useState<"left" | "right" | null>(null);
  const startX = useRef(0);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!active || exiting) return;
    startX.current = e.clientX;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDx(e.clientX - startX.current);
  }

  function release() {
    if (!dragging) return;
    setDragging(false);
    if (dx > SWIPE_THRESHOLD && categoryId) {
      setExiting("right");
      setTimeout(onAccept, EXIT_MS);
    } else if (dx < -SWIPE_THRESHOLD) {
      setExiting("left");
      setTimeout(onSkip, EXIT_MS);
    } else {
      setDx(0);
    }
  }

  function stopDragStart(e: ReactPointerEvent) {
    e.stopPropagation();
  }

  const translateX = exiting === "right" ? EXIT_DISTANCE : exiting === "left" ? -EXIT_DISTANCE : dx;
  const rotate = translateX / 18;
  const opacity = exiting ? 0 : 1;
  const acceptOpacity = Math.min(Math.max(dx / SWIPE_THRESHOLD, 0), 1);
  const skipOpacity = Math.min(Math.max(-dx / SWIPE_THRESHOLD, 0), 1);

  const label = transaction.merchant_name || transaction.raw_description || "(no description)";

  return (
    <div
      className="absolute inset-x-0 top-0 flex justify-center"
      style={{ top: stackIndex * 10, zIndex: 10 - stackIndex }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        style={{
          transform: `translateX(${translateX}px) rotate(${rotate}deg) scale(${1 - stackIndex * 0.04})`,
          opacity,
          transition: dragging ? "none" : "transform 0.25s ease, opacity 0.2s ease",
          touchAction: "none",
        }}
        className={`relative w-full max-w-md select-none rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900 shadow-xl p-6 ${
          active ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"
        }`}
      >
        <div
          className="pointer-events-none absolute top-6 left-6 rounded-md border-2 border-green-500 px-3 py-1 text-sm font-bold text-green-500 -rotate-12"
          style={{ opacity: acceptOpacity }}
        >
          CATEGORIZE
        </div>
        <div
          className="pointer-events-none absolute top-6 right-6 rounded-md border-2 border-red-500 px-3 py-1 text-sm font-bold text-red-500 rotate-12"
          style={{ opacity: skipOpacity }}
        >
          SKIP
        </div>

        <p className="text-xs text-black/50 dark:text-white/50 mb-1">
          {new Date(transaction.booked_at).toLocaleDateString()} · {transaction.accountLabel}
        </p>
        <h3 className="text-lg font-semibold mb-1 break-words">{label}</h3>
        <p className="text-2xl font-bold mb-6">{formatMoney(transaction.amount, transaction.currency, isPrivate)}</p>

        <label className="block text-xs font-medium text-black/50 dark:text-white/50 mb-1">Category</label>
        <select
          value={categoryId}
          onChange={(e) => onCategoryChange(e.target.value)}
          onPointerDown={stopDragStart}
          className="w-full rounded-md border border-black/15 dark:border-white/15 bg-transparent px-3 py-2 text-sm mb-1"
        >
          <option value="">— choose a category —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon ? `${c.icon} ` : ""}
              {c.name}
            </option>
          ))}
        </select>
        {suggestionPending ? (
          <p className="text-xs text-black/40 dark:text-white/40 mb-4 animate-pulse">Suggesting…</p>
        ) : suggestedCategoryId && categoryId === suggestedCategoryId ? (
          <p className="text-xs text-black/40 dark:text-white/40 mb-4">AI suggested</p>
        ) : (
          <p className="text-xs text-black/40 dark:text-white/40 mb-4">&nbsp;</p>
        )}

        <div className="flex gap-3 mt-2">
          <button
            type="button"
            onPointerDown={stopDragStart}
            onClick={onSkip}
            className="flex-1 rounded-md border border-black/15 dark:border-white/15 px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
          >
            ✕ Skip
          </button>
          <button
            type="button"
            onPointerDown={stopDragStart}
            onClick={onAccept}
            disabled={!categoryId}
            className="flex-1 rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-2 text-sm font-medium disabled:opacity-40"
          >
            ✓ Accept
          </button>
        </div>
      </div>
    </div>
  );
}
