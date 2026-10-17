import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Tone = "success" | "error" | "info";
type Toast = { id: number; text: string; tone: Tone };

let next = 1;
let items: Toast[] = [];
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach((l) => l(items));

/** Show a short message at the bottom of the screen (gone after 4 s, errors after 8 s). */
export function toast(text: string, tone: Tone = "success"): void {
  const t = { id: next++, text, tone };
  items = [...items.slice(-3), t]; // at most 4 on screen
  emit();
  setTimeout(() => dismiss(t.id), tone === "error" ? 8000 : 4000);
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
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 print:hidden">
      {list.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${TONE[t.tone]}`}>
          <span className="flex-1">{t.text}</span>
          <button type="button" aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
