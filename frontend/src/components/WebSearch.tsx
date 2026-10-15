import { useState } from "react";
import type { Preferences } from "../types/api";

/** What to look up: words for a Google search, and a question for the AI assistants. */
export type SearchTopic = { google?: string; prompt: string };

/** Open the topic in Google (when it has search words), ChatGPT, Gemini or Claude, each in a new tab. */
export function WebSearch({ topic, label = "Search with" }: { topic: SearchTopic | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!topic) return null;
  const q = (s: string) => encodeURIComponent(s);
  const links: { name: string; href: string; title: string; copy?: boolean }[] = [
    { name: "ChatGPT", href: `https://chatgpt.com/?q=${q(topic.prompt)}`, title: "Ask ChatGPT" },
    // Gemini can't be opened with a question filled in: copy it so it can be pasted.
    { name: "Gemini", href: "https://gemini.google.com/app", title: "Copies the question, then opens Gemini — paste it there", copy: true },
    { name: "Claude", href: `https://claude.ai/new?q=${q(topic.prompt)}`, title: "Ask Claude" },
  ];
  if (topic.google) links.unshift({ name: "Google", href: `https://www.google.com/search?q=${q(topic.google)}`, title: `Google: ${topic.google}` });
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label={label}>
      <span className="font-medium text-slate-500">{label}</span>
      {links.map((l) => (
        <a key={l.name} href={l.href} target="_blank" rel="noopener noreferrer" title={l.title}
          className="btn-secondary px-2 py-1 text-xs"
          onClick={l.copy ? () => {
            void navigator.clipboard?.writeText(topic.prompt).then(() => setCopied(true), () => {});
          } : undefined}>
          {l.name}
        </a>
      ))}
      {copied && <span className="text-slate-500" role="status">Question copied — paste it in Gemini</span>}
    </div>
  );
}

const join = (parts: (string | null | undefined)[], sep = " ") => parts.map((p) => p?.trim()).filter(Boolean).join(sep);
const anyOf = (items: string[]) => (items.length > 1 ? `(${items.map((x) => `"${x}"`).join(" OR ")})` : items.length ? `"${items[0]}"` : "");

/** The parts of the target profile that say which jobs fit. */
export type SearchProfile = Pick<Preferences, "effective_titles" | "required_skills" | "preferred_locations"
  | "min_experience_years" | "max_experience_years">;

/** Open jobs at this company that fit the target profile. */
export function companyTopic(company: string, profile?: SearchProfile | null): SearchTopic | null {
  if (!company.trim()) return null;
  const titles = (profile?.effective_titles ?? []).slice(0, 4);
  const places = (profile?.preferred_locations ?? []).slice(0, 3);
  const skills = (profile?.required_skills ?? []).slice(0, 8);
  const years = join([profile?.min_experience_years, profile?.max_experience_years], "–");
  return {
    google: join([`"${company}"`, anyOf(titles), "jobs", anyOf(places)]),
    prompt: `Find open job postings at ${company} that fit this profile. `
      + join([
        titles.length ? `Roles: ${titles.join(", ")}.` : "",
        skills.length ? `Key skills: ${skills.join(", ")}.` : "",
        places.length ? `Locations: ${places.join(", ")} (or remote).` : "",
        years ? `Experience: ${years} years.` : "",
      ])
      + " For each job give the title, location, posted date and a direct link to the posting on the company's"
      + " careers page or job board. Only list postings you can link to; say so if you find none.",
  };
}

const PORTALS = ["linkedin.com/jobs", "naukri.com", "indeed.com", "glassdoor.co.in", "instahyre.com", "foundit.in"];

/** This exact job on other job portals. */
export function jobTopic(j: { title: string; company: string; location?: string | null; url?: string | null }): SearchTopic | null {
  if (!j.title.trim() || !j.company.trim()) return null;
  const place = j.location?.split(/[,;/]/)[0].trim();
  return {
    google: join([`"${j.title}"`, `"${j.company}"`, place, `(${PORTALS.map((d) => `site:${d}`).join(" OR ")})`]),
    prompt: `Find this job posting on LinkedIn, Naukri, Indeed, Glassdoor, Instahyre, Foundit and ${j.company}'s own `
      + `careers site: "${j.title}" at ${j.company}${j.location ? `, ${j.location}` : ""}`
      + `${j.url ? ` (the posting I have: ${j.url})` : ""}. For each place it is posted, give the direct link, `
      + "whether it is still open, the posted date, and any salary, experience or recruiter details shown there. "
      + "Only list links you actually found.",
  };
}

/** Publicly listed HR / recruiting email addresses for a company (never guessed patterns). */
export function hrEmailTopic(company: string, domain?: string | null, location?: string | null): SearchTopic {
  const place = location?.split(/[,;/]/)[0].trim();
  return {
    google: domain
      ? `"@${domain}" (HR OR recruiter OR "talent acquisition" OR careers OR hiring) email`
      : join([`"${company}"`, '(HR OR recruiter OR "talent acquisition") email', place]),
    prompt: `Find publicly listed email addresses for HR, recruiting or talent acquisition at ${company}`
      + `${domain ? ` (${domain})` : ""}${place ? `, ideally for ${place}` : ""}. Look at its careers pages, job postings, `
      + "press pages and recruiters' public posts. For each address give the source link where it is published "
      + "and who it belongs to. Do not guess or construct addresses from an email pattern; if none is published, say so.",
  };
}

/** Improve an email draft without changing its facts. */
export function polishTopic(subject: string, body: string): SearchTopic {
  return {
    prompt: "Improve this job application email to a recruiter: make it clear, warm and concise (under 170 words), "
      + "and suggest a better subject line. Keep every fact as it is and don't add new claims.\n\n"
      + `Subject: ${subject}\n\n${body}`,
  };
}
