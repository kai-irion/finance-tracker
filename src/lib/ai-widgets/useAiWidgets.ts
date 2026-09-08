"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { validateWidgetSpec, type WidgetSpec } from "@/lib/ai-widgets/spec";
import { executeWidgetQuery, type WidgetChartData } from "@/lib/ai-widgets/execute";

export type LoadedWidget = {
  id: string;
  title: string;
  spec: WidgetSpec;
  data: WidgetChartData | null;
  error: string | null;
};

export function useAiWidgets(page: "dashboard" | "analysis", refreshKey: number) {
  const [widgets, setWidgets] = useState<LoadedWidget[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let rows: { id: string; title: string; spec: unknown }[] | null = null;
    const ordered = await supabase
      .from("ai_widgets")
      .select("id, title, spec")
      .eq("page", page)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (ordered.error) {
      const fallback = await supabase
        .from("ai_widgets")
        .select("id, title, spec")
        .eq("page", page)
        .order("created_at", { ascending: true });
      rows = fallback.data ?? [];
    } else {
      rows = ordered.data ?? [];
    }

    const loaded = await Promise.all(
      (rows ?? []).map(async (row): Promise<LoadedWidget> => {
        const validated = validateWidgetSpec(row.spec);
        if (!validated.ok)
          return { id: row.id, title: row.title, spec: row.spec as WidgetSpec, data: null, error: validated.error };
        try {
          const data = await executeWidgetQuery(supabase, validated.spec);
          return { id: row.id, title: row.title, spec: validated.spec, data, error: null };
        } catch (err) {
          return { id: row.id, title: row.title, spec: validated.spec, data: null, error: (err as Error).message };
        }
      })
    );
    setWidgets(loaded);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, refreshKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(async (id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
    await supabase.from("ai_widgets").delete().eq("id", id);
  }, []);

  /** Best-effort DB persist for cross-device order; localStorage order (pageLayout) is authoritative. */
  const persistDbOrder = useCallback(async (orderedIds: string[]) => {
    await Promise.all(
      orderedIds.map((id, index) =>
        supabase
          .from("ai_widgets")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ position: index } as any)
          .eq("id", id)
      )
    );
  }, []);

  return { widgets, loading, remove, reload: load, persistDbOrder };
}
