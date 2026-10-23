import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../../api/client";
import { Icon } from "../../components/icons";
import { JobStatusBadge, ScoreBadge } from "../../components/ui";
import { humanize } from "../../utils/format";
import { Markdown } from "./Markdown";

type JobItem = { id: number; title: string; company?: string | null; location?: string | null; score?: number | null; status?: string | null; url?: string | null };
type ListItem = { label: string; detail?: string; href?: string | null };
export type ChatCard =
  | { type: "jobs"; title: string; total: number; items: JobItem[] }
  | { type: "list"; title: string; total: number; items: ListItem[] }
  | { type: "counts"; title: string; items: { label: string; value: number }[] };
export type ChatAction = { id: string; kind: string; label: string; method: "POST"; path: string; body: unknown; open_url?: string | null;
  state?: "done" | "failed"; error?: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; cards?: ChatCard[]; actions?: ChatAction[]; mode?: string; note?: string | null };
type ChatReply = { reply: string; cards: ChatCard[]; actions: ChatAction[]; mode: "ai" | "commands"; provider?: string; note?: string | null };
export type ChatStatus = { enabled?: boolean; use_ai?: boolean; ai_configured?: boolean; mode: "ai" | "commands"; provider: string | null;
  model?: string | null; reason?: string | null };

const STORE = "chat.v1";
const SUGGESTIONS = ["Best new jobs this week", "Remote Magento jobs 80+", "What's my pipeline?", "Upcoming interviews",
  "Follow-ups due", "Status of Accenture", "Where did I apply in the last 30 days?"];
const PROVIDER_NAMES: Record<string, string> = { anthropic: "Claude", gemini: "Gemini", openai: "OpenAI", omniroute: "OmniRoute", ollama: "Ollama" };

function load(): ChatMessage[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function save(messages: ChatMessage[]) {
  try { localStorage.setItem(STORE, JSON.stringify(messages.slice(-60))); } catch { /* private window */ }
}

/** Ask anything about your jobs, applications, interviews… and confirm the changes it proposes. */
export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["chat", "status"], queryFn: () => api.get<ChatStatus>("/chat/status"), staleTime: 60_000 });
  const [messages, setMessages] = useState<ChatMessage[]>(load);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const update = (next: ChatMessage[]) => { setMessages(next); save(next); };

  useEffect(() => { end.current?.scrollIntoView?.({ block: "end" }); }, [messages.length]);
  useEffect(() => { input.current?.focus(); }, []);

  const ask = useMutation({
    mutationFn: (history: ChatMessage[]) =>
      api.post<ChatReply>("/chat", { messages: history.slice(-16).map(({ role, content }) => ({ role, content: content.slice(0, 7900) })) }),
    onSuccess: (r, history) => update([...history, { role: "assistant", content: r.reply, cards: r.cards, actions: r.actions, mode: r.mode, note: r.note }]),
    onError: (e, history) => update([...history, { role: "assistant", content: `⚠️ ${errorMessage(e)}` }]),
  });
  const send = (value = text) => {
    const q = value.trim();
    if (!q || ask.isPending) return;
    const history = [...messages, { role: "user" as const, content: q }];
    update(history);
    setText("");
    ask.mutate(history);
  };
  const confirm = async (mi: number, action: ChatAction) => {
    const mark = (patch: Partial<ChatAction>) => {
      const next = messages.map((m, i) => (i !== mi ? m : { ...m, actions: m.actions?.map((a) => (a.id === action.id ? { ...a, ...patch } : a)) }));
      update(next);
    };
    try {
      await api.post(action.path, action.body);
      mark({ state: "done" });
      qc.invalidateQueries();
    } catch (e) {
      mark({ state: "failed", error: errorMessage(e) });
    }
  };

  const s = status.data;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <Icon name="chat" className="h-5 w-5 text-indigo-600" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-tight">Assistant</h2>
          <p className="truncate text-xs text-slate-500" title={s?.reason ?? undefined}>
            {!s ? "…" : s.mode === "ai" ? `AI · ${PROVIDER_NAMES[s.provider ?? ""] ?? s.provider}${s.model ? ` (${s.model})` : ""}`
              : s.ai_configured && s.use_ai === false
                ? <>Built-in commands · AI is <Link className="link" to="/settings/about" onClick={onClose}>turned off</Link></>
                : <>Built-in commands · <Link className="link" to="/settings/about" onClick={onClose}>add an AI key</Link> to ask anything</>}
          </p>
        </div>
        {messages.length > 0 && <button className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => update([])}>Clear</button>}
        {onClose && <button className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close assistant" onClick={onClose}><Icon name="close" /></button>}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3 text-slate-600">
            <p>Ask about your jobs, applications, interviews, follow-ups, offers, companies or recruiters — or tell me what to do
              (“apply to 512”, “mark 77 not relevant”). Changes wait for your confirmation.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((q) => <button key={q} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => send(q)}>{q}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} className="ml-8 rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-white whitespace-pre-wrap">{m.content}</div>
        ) : (
          <div key={i} className="mr-4 space-y-2">
            <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 dark:bg-white/5"><Markdown text={m.content} /></div>
            {m.note && <p className="text-xs text-amber-700">{m.note}</p>}
            {m.cards?.map((c, j) => <Card key={j} card={c} />)}
            {m.actions?.map((a) => (
              <div key={a.id} className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-2 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                <p className="mb-1.5 text-xs font-medium">{a.label}</p>
                {a.state === "done" ? <p className="text-xs text-emerald-700">✓ Done{a.kind === "apply" && a.open_url ? <> · <a className="link" href={a.open_url} target="_blank" rel="noopener noreferrer">open the apply page</a></> : null}</p>
                  : <div className="flex flex-wrap items-center gap-2">
                    <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => confirm(i, a)}>Confirm</button>
                    {a.open_url && <a className="link text-xs" href={a.open_url} target="_blank" rel="noopener noreferrer">Open the job posting</a>}
                    {a.state === "failed" && <span className="text-xs text-rose-600">{a.error}</span>}
                  </div>}
              </div>
            ))}
          </div>
        ))}
        {ask.isPending && <div className="mr-4 inline-flex gap-1 rounded-2xl bg-slate-100 px-3 py-2 text-slate-500 dark:bg-white/5" aria-label="Thinking">
          <span className="animate-pulse">●</span><span className="animate-pulse [animation-delay:150ms]">●</span><span className="animate-pulse [animation-delay:300ms]">●</span></div>}
        <div ref={end} />
      </div>

      <form className="flex items-end gap-2 border-t border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={input} aria-label="Message the assistant" rows={1} className="input max-h-32 min-h-[38px] flex-1 resize-none py-2"
          placeholder={s?.mode === "ai" ? "Ask anything…" : "e.g. remote magento jobs 80+"} value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button type="submit" className="btn-primary h-[38px] px-3" aria-label="Send" disabled={!text.trim() || ask.isPending}><Icon name="send" /></button>
      </form>
    </div>
  );
}

function Card({ card }: { card: ChatCard }) {
  if (card.type === "counts") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {card.items.map((x) => <span key={x.label} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-white/5">{humanize(x.label)}: <b>{x.value}</b></span>)}
      </div>
    );
  }
  if (!card.items.length) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="bg-slate-50 px-2 py-1 text-xs font-medium text-slate-500 dark:bg-white/5">{card.title}{card.total > card.items.length ? ` · ${card.items.length} of ${card.total}` : ""}</div>
      <ul className="divide-y divide-slate-100">
        {card.type === "jobs" ? card.items.map((j) => (
          <li key={j.id} className="flex items-start gap-2 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <Link className="link font-medium" to={`/jobs/${j.id}`}>#{j.id} {j.title}</Link>
              <div className="truncate text-xs text-slate-500">{[j.company, j.location].filter(Boolean).join(" · ")}</div>
            </div>
            <ScoreBadge score={j.score ?? null} />
            <JobStatusBadge value={j.status} />
          </li>
        )) : card.items.map((x, i) => (
          <li key={i} className="px-2 py-1.5">
            {x.href ? <Link className="link font-medium" to={x.href}>{x.label}</Link> : <span className="font-medium">{x.label}</span>}
            {x.detail && <div className="text-xs text-slate-500">{x.detail}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The round button at the bottom right of every page; ⌘J / Ctrl+J opens and closes the chat. */
export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const status = useQuery({ queryKey: ["chat", "status"], queryFn: () => api.get<ChatStatus>("/chat/status"), staleTime: 60_000 });
  const enabled = status.data?.enabled !== false; // off only when Settings says so
  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [enabled]);
  if (!enabled) return null;
  return open ? (
    <div className="fixed inset-y-0 right-0 z-50 w-full border-l border-slate-200 bg-surface shadow-2xl sm:w-[440px]" role="dialog" aria-label="Assistant">
      <ChatPanel onClose={() => setOpen(false)} />
    </div>
  ) : (
    <button className="fixed right-4 bottom-20 z-40 md:bottom-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700"
      aria-label="Open assistant (⌘J)" title="Assistant (⌘J)" onClick={() => setOpen(true)}>
      <Icon name="chat" className="h-6 w-6" />
    </button>
  );
}
