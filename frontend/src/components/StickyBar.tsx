import { useEffect, useState, type ReactNode } from "react";
import { BackButton } from "./ui";

/** True once `el` has scrolled up out of view (under the top bars). */
export function useScrolledPast(el: HTMLElement | null): boolean {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setGone(!e.isIntersecting && e.boundingClientRect.top < 0),
      { rootMargin: "-120px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return gone;
}

/**
 * Back button that stays under the top bar while a long page scrolls. Pages add a title and
 * actions as `children`, usually shown once their own heading has scrolled away.
 */
export function StickyBar({ fallback, label, children }: { fallback: string; label: string; children?: ReactNode }) {
  return (
    <div className="sticky top-[59px] z-20 -mx-4 -mt-2 flex items-center gap-3 bg-page/75 px-4 py-2 backdrop-blur-xl print:static md:-mx-8 md:px-8">
      <BackButton fallback={fallback} label={label} className="shrink-0" />
      {children}
    </div>
  );
}
