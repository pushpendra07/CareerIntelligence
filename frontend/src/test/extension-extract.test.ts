import source from "../../../browser-extension/extract.js?raw";
import { afterEach, describe, expect, it } from "vitest";

type Extract = { detail: () => Record<string, string>; searchLinks: () => string[] };
const load = (): Extract => {
  new Function(source)();
  return (globalThis as unknown as { ciExtract: Extract }).ciExtract;
};

/** The reader as it runs on a portal page: `location` is that page's address. */
const loadAt = (url: string): Extract => {
  new Function("location", source)(new URL(url));
  return (globalThis as unknown as { ciExtract: Extract }).ciExtract;
};

afterEach(() => { document.head.innerHTML = ""; document.body.innerHTML = ""; document.title = ""; });

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

describe("Job collector: portals without filling anything in", () => {
  it("reads LinkedIn from the tab title, company link and 'About the job' when the layout changed", () => {
    document.title = "(3) Senior PHP Developer | Acme Commerce | LinkedIn";
    document.body.innerHTML = `<div class="x1"><a href="https://www.linkedin.com/company/acme-commerce/life">Acme Commerce</a>
      <div><h2>About the job</h2><div>${"Build Magento 2 and Laravel services for our stores. ".repeat(10)} 5-8 years experience.</div></div></div>`;
    const job = loadAt("https://www.linkedin.com/jobs/search/?keywords=php&currentJobId=4012345678&trk=abc").detail();
    expect(job).toMatchObject({ title: "Senior PHP Developer", company: "Acme Commerce", portal: "LinkedIn",
      url: "https://www.linkedin.com/jobs/view/4012345678/", experience: "5-8 years", listing: false });
    expect(job.description).toContain("Magento 2 and Laravel");
  });

  it("reads Shine and drops the tracking query from a link with the posting ID", () => {
    document.body.innerHTML = `<h1 class="jobDetail_title">Magento Developer</h1><div class="jobDetail_companyName">Beta Retail Pvt Ltd</div>
      <div class="jobDetail_location">Jaipur</div><div class="jobDetail_experience">3 to 6 Yrs</div>
      <div class="jobDetail_jobDescription">Adobe Commerce, PHP, MySQL.</div>`;
    const job = loadAt("https://www.shine.com/jobs/magento-developer/beta-retail-pvt-ltd/17654321?sid=9&utm_source=x").detail();
    expect(job).toMatchObject({ title: "Magento Developer", company: "Beta Retail Pvt Ltd", location: "Jaipur",
      experience: "3 to 6 Yrs", portal: "Shine", url: "https://www.shine.com/jobs/magento-developer/beta-retail-pvt-ltd/17654321" });
  });

  it("reads Naukri's tab title when its selectors miss", () => {
    document.title = "PHP Lead - Gamma Tech Solutions - 6 to 10 years of experience - Naukri.com";
    const job = loadAt("https://www.naukri.com/job-listings-php-lead-gamma-tech-solutions-pune-6-to-10-years-231024500123?src=jobsearchDesk&sid=1&xp=2").detail();
    expect(job).toMatchObject({ title: "PHP Lead", company: "Gamma Tech Solutions", portal: "Naukri", listing: false,
      url: "https://www.naukri.com/job-listings-php-lead-gamma-tech-solutions-pune-6-to-10-years-231024500123" });
  });

  it("flags a search results page with no job open, instead of saving it as a job", () => {
    document.title = "Php Developer Jobs in Pune - Foundit";
    document.body.innerHTML = '<h1>245 Php Developer Jobs in Pune</h1><a href="/job/php-developer-acme-pune-31234567">PHP Developer</a>';
    const ex = loadAt("https://www.foundit.in/srp/results?query=php&locations=Pune");
    expect(ex.detail().listing).toBe(true);
    expect(ex.searchLinks()).toEqual(["https://www.foundit.in/job/php-developer-acme-pune-31234567"]);
  });

  it("lists Shine job links on its search page", () => {
    document.body.innerHTML = '<a href="/jobs/php-developer/acme/17654321?sid=1">PHP</a><a href="/jobs/companies">x</a>';
    expect(loadAt("https://www.shine.com/job-search/php-developer-jobs-in-pune").searchLinks())
      .toEqual(["https://www.shine.com/jobs/php-developer/acme/17654321"]);
  });
});
