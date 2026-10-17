/** Small line icons (24px grid, stroke follows the text colour). */
const PATHS: Record<string, string> = {
  menu: "M4 6h16M4 12h16M4 18h16",
  today: "M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  jobs: "M9 6V5a2 2 0 012-2h2a2 2 0 012 2v1m-11 0h16a1 1 0 011 1v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7a1 1 0 011-1zm-1 6h18",
  pipeline: "M4 5h16M7 12h10M10 19h4",
  reports: "M4 20h16M7 16v-5m5 5V6m5 10v-8",
  followups: "M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z",
  profile: "M16 8a4 4 0 11-8 0 4 4 0 018 0zM4 21a8 8 0 0116 0",
  settings: "M10.3 4.3a1.7 1.7 0 013.4 0 1.7 1.7 0 002.6 1.1 1.7 1.7 0 012.4 2.4 1.7 1.7 0 001 2.5 1.7 1.7 0 010 3.4 1.7 1.7 0 00-1 2.6 1.7 1.7 0 01-2.4 2.4 1.7 1.7 0 00-2.6 1 1.7 1.7 0 01-3.4 0 1.7 1.7 0 00-2.6-1 1.7 1.7 0 01-2.4-2.4 1.7 1.7 0 00-1-2.6 1.7 1.7 0 010-3.4 1.7 1.7 0 001-2.5 1.7 1.7 0 012.4-2.4 1.7 1.7 0 002.6-1.1zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
  sun: "M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4l-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7L5.6 5.6M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  moon: "M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z",
  monitor: "M3 5h18v11H3zM8 20h8m-4-4v4",
  close: "M6 6l12 12M18 6L6 18",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z",
  bell: "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9",
  calendar: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  doc: "M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zm0 0v5h5M9 13h6M9 17h4",
  send: "M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z",
  inbox: "M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6l2-8z",
  trophy: "M8 4h8v5a4 4 0 01-8 0V4zm0 2H4v1a4 4 0 004 4m8-5h4v1a4 4 0 01-4 4m-4 2v4m-4 3h8",
  trend: "M3 17l6-6 4 4 8-8m0 0v6m0-6h-6",
  check: "M5 12.5l4.5 4.5L19 7",
  search: "M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z",
};

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
