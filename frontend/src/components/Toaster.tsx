import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Tone = "success" | "error" | "info";
/** A button in the toast, e.g. Undo; clicking it runs `run` and closes the toast. */
export type ToastAction = { label: string; run: () => void };
type Toast = { id: number; text: string; tone: Tone; action?: ToastAction };

let next = 1;
let items: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l(items));

/** Show a short message at the bottom of the screen (gone after 4 s, with an action 6 s,
 * errors after 8 s). */
export function toast(text: string, tone: Tone = "success", action?: ToastAction): void {
  const t = { id: next++, text, tone, action };
  items = [...items.slice(-3), t]; // at most 4 on screen
  emit();
  setTimeout(() => dismiss(t.id), tone === "error" ? 8000 : action ? 6000 : 4000);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const TONE: Record<Tone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
  info: "border-slate-200 bg-surface text-slate-800",
};

export function Toaster() {
  const [list, setList] = useState<Toast[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => { listeners.delete(setList); };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] md:bottom-4 flex flex-col items-center gap-2 px-4 print:hidden">
      {list.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
          className={`toast-in pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${TONE[t.tone]}`}>
          <span className="flex-1">{t.text}</span>
          {t.action && (
            <button type="button" className="font-semibold text-indigo-700 hover:underline"
              onClick={() => { dismiss(t.id); t.action!.run(); }}>{t.action.label}</button>
          )}
          <button type="button" aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
