import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin-client";
import { chatCompletion, OpenRouterConfigError, type ChatMessage } from "@/lib/openrouter";
import { validateWidgetSpec, WIDGET_SCHEMA_DESCRIPTION } from "@/lib/ai-widgets/spec";

const MAX_HISTORY_MESSAGES = 10;
const MAX_MESSAGE_LEN = 2000;

type ChatResponse =
  | { type: "widget"; title: string; spec: unknown }
  | { type: "message"; text: string }
  | { type: "error"; text: string };

// The model is asked to reply with nothing but a JSON object, but free models don't always
// comply literally — wrapping it in a ```json fence or a stray sentence is common. This pulls
// out the first top-level {...} block rather than trusting the whole reply to be valid JSON.
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found in reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function POST(request: NextRequest) {
  let body: { page?: unknown; message?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ChatResponse>({ type: "error", text: "Invalid request body." }, { status: 400 });
  }

  const { page, message, history } = body;
  if (page !== "dashboard" && page !== "analysis") {
    return NextResponse.json<ChatResponse>({ type: "error", text: 'page must be "dashboard" or "analysis".' }, { status: 400 });
  }
  if (typeof message !== "string" || message.trim().length === 0 || message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json<ChatResponse>({ type: "error", text: "message must be a non-empty string." }, { status: 400 });
  }
  const priorTurns: ChatMessage[] = Array.isArray(history)
    ? history
        .filter(
          (m): m is ChatMessage =>
            typeof m === "object" &&
            m !== null &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        )
        .slice(-MAX_HISTORY_MESSAGES)
    : [];

  const [{ data: categories }, { data: accounts }] = await Promise.all([
    supabaseAdmin.from("categories").select("name").order("name"),
    supabaseAdmin.from("accounts").select("account_type, provider").eq("is_archived", false),
  ]);
  const categoryNames = Array.from(new Set((categories ?? []).map((c) => c.name)));
  const accountTypes = Array.from(new Set((accounts ?? []).map((a) => a.account_type)));
  const providers = Array.from(new Set((accounts ?? []).map((a) => a.provider)));

  const systemPrompt = `You are a chart-building assistant embedded in a personal finance app's "${page}" page. A user describes what they want to track and you either propose a chart or explain why you can't.

Layout capabilities (do not invent anything beyond this):
- You can only CREATE new charts. You cannot move, reorder, resize, edit, or delete any chart yourself.
- The user CAN reorder EVERY chart on the page manually, standard built-ins and AI charts alike: drag any card by its grab handle, or use the move-to-top / move-up / move-down buttons in the card header. Any chart (including one you built) can be moved to the very top of the page this way. New charts always appear at the bottom initially.
- The user CAN hide any standard chart with its Hide button (restorable under Hidden charts) and CAN permanently remove AI charts with Remove.
- If the user asks to move a chart (e.g. "move it to the top"), do NOT claim you moved it. Reply with {"type":"message","text":"..."} explaining they can drag that chart by its handle or use its move-to-top button in the card header to move it manually.

${WIDGET_SCHEMA_DESCRIPTION}

This user's actual category names: ${categoryNames.length ? categoryNames.join(", ") : "(none yet)"}.
This user's actual account types: ${accountTypes.length ? accountTypes.join(", ") : "(none yet)"}.
This user's actual account providers: ${providers.length ? providers.join(", ") : "(none yet)"}.

Respond with ONLY a single JSON object, no markdown fences, no text outside the JSON:
- {"type":"widget","title":"...","chartType":"...","query":{...}} when you can build the chart.
- {"type":"message","text":"..."} for anything else — a clarifying question, an explanation of why the data isn't available, or a reply to small talk.`;

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...priorTurns, { role: "user", content: message }];

  let reply: string;
  try {
    reply = await chatCompletion(supabaseAdmin, messages, 600);
  } catch (err) {
    const status = err instanceof OpenRouterConfigError ? 400 : 502;
    return NextResponse.json<ChatResponse>({ type: "error", text: (err as Error).message }, { status });
  }

  let parsed: unknown;
  try {
    parsed = extractJson(reply);
  } catch {
    return NextResponse.json<ChatResponse>({
      type: "message",
      text: "I couldn't format that as a chart — could you rephrase what you'd like to see?",
    });
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.type === "message" && typeof obj.text === "string") {
    return NextResponse.json<ChatResponse>({ type: "message", text: obj.text });
  }
  if (obj.type === "widget") {
    const result = validateWidgetSpec(obj);
    if (!result.ok) {
      return NextResponse.json<ChatResponse>({
        type: "message",
        text: `I tried to build that but the result wasn't valid (${result.error}) — could you rephrase it?`,
      });
    }
    return NextResponse.json<ChatResponse>({ type: "widget", title: result.spec.title, spec: result.spec });
  }

  return NextResponse.json<ChatResponse>({
    type: "message",
    text: "I couldn't format that as a chart — could you rephrase what you'd like to see?",
  });
}
