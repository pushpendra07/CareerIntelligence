/** Small line icons (24px grid, stroke follows the text colour). */
const PATHS: Record<string, string> = {
  menu: "M4 6h16M4 12h16M4 18h16",
  today: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  jobs: "M9 6V5a2 2 0 012-2h2a2 2 0 012 2v1m-11 0h16a1 1 0 011 1v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7a1 1 0 011-1zm-1 6h18",
  pipeline: "M4 5h16M7 12h10M10 19h4",
  followups: "M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z",
  profile: "M16 8a4 4 0 11-8 0 4 4 0 018 0zM4 21a8 8 0 0116 0",
  settings: "M10.3 4.3a1.7 1.7 0 013.4 0 1.7 1.7 0 002.6 1.1 1.7 1.7 0 012.4 2.4 1.7 1.7 0 001 2.5 1.7 1.7 0 010 3.4 1.7 1.7 0 00-1 2.6 1.7 1.7 0 01-2.4 2.4 1.7 1.7 0 00-2.6 1 1.7 1.7 0 01-3.4 0 1.7 1.7 0 00-2.6-1 1.7 1.7 0 01-2.4-2.4 1.7 1.7 0 00-1-2.6 1.7 1.7 0 010-3.4 1.7 1.7 0 001-2.5 1.7 1.7 0 012.4-2.4 1.7 1.7 0 002.6-1.1zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
  sun: "M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4l-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7L5.6 5.6M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  moon: "M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z",
  monitor: "M3 5h18v11H3zM8 20h8m-4-4v4",
  close: "M6 6l12 12M18 6L6 18",
};

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
