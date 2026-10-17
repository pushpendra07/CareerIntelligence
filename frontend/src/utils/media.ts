import { useEffect, useState } from "react";

const query = (q: string) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);

/** True while the media query matches (false where matchMedia is missing, e.g. tests). */
export function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => !!query(q)?.matches);
  useEffect(() => {
    const mq = query(q);
    if (!mq) return;
    const update = () => setOn(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [q]);
  return on;
}

/** Phone-sized screen (below Tailwind's md breakpoint): lists switch from tables to cards. */
export const usePhone = () => useMedia("(max-width: 767px)");
