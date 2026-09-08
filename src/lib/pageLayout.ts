"use client";

import { useCallback, useEffect, useState } from "react";

function storageKey(page: string, kind: "order" | "hidden") {
  return `fh:layout:${page}:${kind}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota — layout simply won't persist, app still works.
  }
}

/**
 * Unified page layout: a single ordered list of section ids (both built-in
 * standard charts and AI widgets as `ai:<uuid>`) plus a hidden set.
 * Stored in localStorage so it works immediately with zero DB migrations.
 * DB `position` on ai_widgets (migration 014) remains a best-effort secondary
 * sync for cross-device order — localStorage is the source of truth for rendering.
 */
export function usePageLayout(page: "dashboard" | "analysis", defaultOrder: string[]) {
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [hidden, setHidden] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  // Load once + when the set of known ids grows (e.g. a new AI chart arrives).
  useEffect(() => {
    const storedOrder = readJson<string[]>(storageKey(page, "order"));
    const storedHidden = readJson<string[]>(storageKey(page, "hidden"));
    if (storedHidden) setHidden(storedHidden.filter((id) => typeof id === "string"));
    if (storedOrder && Array.isArray(storedOrder)) {
      const known = new Set(defaultOrder);
      const kept = storedOrder.filter((id) => known.has(id));
      const missing = defaultOrder.filter((id) => !kept.includes(id));
      setOrder([...kept, ...missing]);
    } else {
      setOrder(defaultOrder);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, defaultOrder.join("|")]);

  const persist = useCallback(
    (nextOrder: string[], nextHidden: string[]) => {
      setOrder(nextOrder);
      setHidden(nextHidden);
      writeJson(storageKey(page, "order"), nextOrder);
      writeJson(storageKey(page, "hidden"), nextHidden);
    },
    [page]
  );

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      const visible = order.filter((x) => !hidden.includes(x));
      const idx = visible.indexOf(id);
      const target = idx + direction;
      if (idx === -1 || target < 0 || target >= visible.length) return;
      const reordered = [...visible];
      const [m] = reordered.splice(idx, 1);
      reordered.splice(target, 0, m);
      // Reinsert hidden ids at the end (they keep relative order, stay hidden).
      const hiddenIds = order.filter((x) => hidden.includes(x));
      persist([...reordered.filter((x) => !hidden.includes(x)), ...hiddenIds], hidden);
    },
    [order, hidden, persist]
  );

  const moveToTop = useCallback(
    (id: string) => {
      if (order.filter((x) => !hidden.includes(x))[0] === id) return;
      const without = order.filter((x) => x !== id);
      // Insert at the very top of the visible list.
      const firstVisible = without.find((x) => !hidden.includes(x));
      if (!firstVisible) {
        persist([id, ...without], hidden);
        return;
      }
      const idx = without.indexOf(firstVisible);
      without.splice(idx, 0, id);
      persist(without, hidden);
    },
    [order, hidden, persist]
  );

  const hide = useCallback(
    (id: string) => {
      if (hidden.includes(id)) return;
      persist(order, [...hidden, id]);
    },
    [order, hidden, persist]
  );

  const restore = useCallback(
    (id: string) => {
      persist(
        order,
        hidden.filter((x) => x !== id)
      );
    },
    [order, hidden, persist]
  );

  const reorder = useCallback(
    (dragId: string, targetId: string) => {
      if (dragId === targetId) return;
      const visible = order.filter((x) => !hidden.includes(x));
      const from = visible.indexOf(dragId);
      const to = visible.indexOf(targetId);
      if (from === -1 || to === -1) return;
      const reordered = [...visible];
      const [m] = reordered.splice(from, 1);
      reordered.splice(to, 0, m);
      const hiddenIds = order.filter((x) => hidden.includes(x));
      persist([...reordered, ...hiddenIds], hidden);
    },
    [order, hidden, persist]
  );

  const reset = useCallback(() => {
    persist(defaultOrder, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, defaultOrder.join("|")]);

  return { order, hidden, ready, move, moveToTop, hide, restore, reorder, reset, setOrderDirect: persist };
}
