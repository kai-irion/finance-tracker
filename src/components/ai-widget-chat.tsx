"use client";

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";

type Message = { role: "user" | "assistant"; content: string; isError?: boolean };

type ChatResponse =
  | { type: "widget"; title: string; spec: unknown }
  | { type: "message"; text: string }
  | { type: "error"; text: string };

export function AiWidgetChat({ page, onWidgetAdded }: { page: "dashboard" | "analysis"; onWidgetAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);

    try {
      const res = await fetch("/api/ai-widgets/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page,
          message: text,
          history: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data: ChatResponse = await res.json();

      if (data.type === "widget") {
        // Append at the end of the manual order. Position defaults to 0 in the DB,
        // so an explicit max+1 keeps newly added charts last for users whose rows
        // predate the position column or who already reordered widgets.
        // If the 014 migration hasn't been applied yet, fall back to a position-less insert.
        const { data: existing } = await supabase.from("ai_widgets").select("position").eq("page", page);
        const maxPosition = (existing ?? []).reduce<number | null>((max, row) => {
          const p = (row as { position?: unknown }).position;
          if (typeof p !== "number") return max;
          return max === null ? p : Math.max(max, p);
        }, null);
        let insertError: { message: string } | null = null;
        if (existing !== null || maxPosition !== null) {
          const { error } = await supabase
            .from("ai_widgets")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .insert({ page, title: data.title, spec: data.spec, position: maxPosition === null ? 0 : maxPosition + 1 } as any);
          insertError = error;
          if (error && /position/i.test(error.message)) {
            const retry = await supabase.from("ai_widgets").insert({ page, title: data.title, spec: data.spec });
            insertError = retry.error;
          }
        } else {
          const { error } = await supabase.from("ai_widgets").insert({ page, title: data.title, spec: data.spec });
          insertError = error;
        }
        const error = insertError;
        if (error) {
          setMessages((prev) => [...prev, { role: "assistant", content: `Built the chart but couldn't save it: ${error.message}`, isError: true }]);
        } else {
          setMessages((prev) => [...prev, { role: "assistant", content: `Added chart: "${data.title}".` }]);
          onWidgetAdded();
        }
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: data.text, isError: data.type === "error" }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong reaching the AI. Try again.", isError: true }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div>
          <h2 className="text-sm font-medium text-black/70 dark:text-white/70">Customize with AI</h2>
          <p className="text-xs text-black/50 dark:text-white/50">
            Tell it what you want to track — it can build a new chart, or tell you if the data isn&apos;t available.
          </p>
        </div>
        <span className={`shrink-0 text-black/40 dark:text-white/40 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="border-t border-black/10 dark:border-white/10 p-4 flex flex-col gap-3">
          {messages.length > 0 && (
            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-md px-3 py-2 max-w-[85%] ${
                    m.role === "user"
                      ? "self-end bg-black text-white dark:bg-white dark:text-black"
                      : m.isError
                        ? "self-start bg-red-500/10 text-red-700 dark:text-red-400"
                        : "self-start bg-black/5 dark:bg-white/10 text-black/80 dark:text-white/80"
                  }`}
                >
                  {m.content}
                </div>
              ))}
              {sending && <div className="self-start text-xs text-black/40 dark:text-white/40">Thinking…</div>}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='e.g. "Show me my total debt" or "Track my savings over time"'
              disabled={sending}
              className="flex-1 rounded-md border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="shrink-0 rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
