/**
 * Job portals the user searches in their own browser (they can't be scanned): where each one's
 * search page is, already filled in with a title, a place and a posting age where the portal
 * supports it. The Job collector extension (browser-extension/) knows the same portals.
 */
export type Portal = { name: string; host: string; search: (q: SearchQuery) => string; filled: boolean };
export const WORK_TYPES = ["Remote", "Hybrid", "Onsite"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
/** work: which work types to search; none or all three = no filter. */
export type SearchQuery = { title: string; location: string; days: number; work?: WorkType[] };

const enc = encodeURIComponent;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isRemote = (l: string) => /remote/i.test(l);
/** "Remote India" -> search India (with the portal's remote filter where it has one). */
const place = (l: string) => (isRemote(l) ? "India" : l);
/** The work types to filter on, as the portal's codes; "" when there is nothing to filter. */
function workFilter(q: SearchQuery, codes: Record<WorkType, string>): string[] {
  const chosen = new Set<WorkType>(q.work ?? []);
  if (isRemote(q.location)) chosen.add("Remote");
  return chosen.size === 0 || chosen.size === 3 ? [] : [...chosen].map((w) => codes[w]);
}

export const PORTALS: Portal[] = [
  { name: "LinkedIn", host: "www.linkedin.com", filled: true,
    search: (q) => {
      const wt = workFilter(q, { Onsite: "1", Remote: "2", Hybrid: "3" });
      return `https://www.linkedin.com/jobs/search/?keywords=${enc(q.title)}&location=${enc(place(q.location))}`
        + `&f_TPR=r${q.days * 86400}${wt.length ? `&f_WT=${enc(wt.join(","))}` : ""}`;
    } },
  { name: "Naukri", host: "www.naukri.com", filled: true,
    search: (q) => {
      const wfh = workFilter(q, { Onsite: "0", Remote: "2", Hybrid: "3" });
      return `https://www.naukri.com/${slug(q.title)}-jobs${isRemote(q.location) ? "" : `-in-${slug(q.location)}`}`
        + `?k=${enc(q.title)}${isRemote(q.location) ? "" : `&l=${enc(q.location)}`}${wfh.map((w) => `&wfhType=${w}`).join("")}&jobAge=${q.days}`;
    } },
  { name: "Indeed India", host: "in.indeed.com", filled: true,
    search: ({ title, location, days }) => `https://in.indeed.com/jobs?q=${enc(isRemote(location) ? `${title} remote` : title)}`
      + `&l=${enc(isRemote(location) ? "" : location)}&fromage=${[1, 3, 7, 14].find((d) => d >= days) ?? 14}` },
  { name: "Foundit", host: "www.foundit.in", filled: true,
    search: ({ title, location }) => `https://www.foundit.in/srp/results?query=${enc(title)}&locations=${enc(place(location))}` },
  { name: "Glassdoor", host: "www.glassdoor.co.in", filled: true,
    search: ({ title, location, days }) => `https://www.glassdoor.co.in/Job/jobs.htm?sc.keyword=${enc(title)}&locKeyword=${enc(place(location))}&fromAge=${days}` },
  { name: "Shine", host: "www.shine.com", filled: true,
    search: ({ title, location }) => `https://www.shine.com/job-search/${slug(title)}-jobs${isRemote(location) ? "" : `-in-${slug(location)}`}` },
  { name: "Instahyre", host: "www.instahyre.com", filled: false, search: () => "https://www.instahyre.com/search-jobs/" },
  { name: "Wellfound", host: "wellfound.com", filled: false, search: () => "https://wellfound.com/jobs" },
  { name: "Cutshort", host: "cutshort.io", filled: false, search: () => "https://cutshort.io/jobs" },
  { name: "Hirist", host: "www.hirist.tech", filled: false, search: () => "https://www.hirist.tech/" },
  { name: "iimjobs", host: "www.iimjobs.com", filled: false, search: () => "https://www.iimjobs.com/" },
];
export const PORTAL_NAMES = PORTALS.map((p) => p.name);
