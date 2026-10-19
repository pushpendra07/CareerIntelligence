import source from "../../../browser-extension/extract.js?raw";
import { afterEach, describe, expect, it } from "vitest";

type Extract = { detail: () => Record<string, string>; searchLinks: () => string[] };
const load = (): Extract => {
  new Function(source)();
  return (globalThis as unknown as { ciExtract: Extract }).ciExtract;
};

afterEach(() => { document.head.innerHTML = ""; document.body.innerHTML = ""; });

describe("Job collector: reading job pages", () => {
  it("reads schema.org JobPosting data (Naukri, Glassdoor, company sites)", () => {
    document.head.innerHTML = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [{
      "@type": "JobPosting", title: "Adobe Commerce Tech Lead", datePosted: "2026-10-15T00:00:00Z",
      hiringOrganization: { "@type": "Organization", name: "Acme Commerce" },
      jobLocation: [{ address: { addressLocality: "Pune", addressRegion: "Maharashtra", addressCountry: "IN" } }],
      description: "<p>Lead our <b>Magento 2</b> team.</p><ul><li>PHP</li><li>GraphQL</li></ul>",
      experienceRequirements: { monthsOfExperience: 96 } }] })}</script>`;
    const job = load().detail();
    expect(job).toMatchObject({ title: "Adobe Commerce Tech Lead", company: "Acme Commerce", location: "Pune, Maharashtra, IN",
      posted: "2026-10-15", experience: "8+ years" });
    expect(job.description).toContain("Lead our Magento 2 team.");
    expect(job.description).toContain("GraphQL");
  });

  it("uses the page itself on a company careers site without JobPosting data", () => {
    document.head.innerHTML = '<meta property="og:site_name" content="Beta Labs">';
    document.body.innerHTML = "<main><h1>Senior Laravel Developer</h1>\n<p>Hybrid in Jaipur. Laravel, PHP, MySQL.</p></main>";
    const job = load().detail();
    expect(job).toMatchObject({ title: "Senior Laravel Developer", company: "Beta Labs", workplace: "Hybrid" });
    expect(job.description).toContain("Laravel, PHP, MySQL");
  });

  it("finds the company in the tab title on job boards like Greenhouse", () => {
    document.title = "Job Application for Sr. Software Engineer at Sureify";
    document.body.innerHTML = "<main><h1>Sr. Software Engineer</h1>\n<p>Full stack. React, PHP, Go.</p></main>";
    expect(load().detail()).toMatchObject({ title: "Sr. Software Engineer", company: "Sureify" });
    document.title = "";
  });
});
