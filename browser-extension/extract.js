// Reads job postings from the page the user is looking at. Injected by the extension into the
// current tab (popup: "add this job") or into a portal tab (collector). Defines
// globalThis.ciExtract = { detail(), searchLinks() }. Read-only: never clicks or submits anything.
(() => {
  const PORTAL_HOSTS = /(^|\.)(linkedin\.com|naukri\.com|indeed\.com|indeed\.co\.in|foundit\.in|glassdoor\.co\.in|glassdoor\.com|instahyre\.com|wellfound\.com|cutshort\.io|hirist\.tech|iimjobs\.com|monsterindia\.com)$/;
  const MAX_JD = 50000;

  const text = (el) => (el ? (el.innerText || el.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : "");
  const first = (selectors, root = document) => {
    for (const s of selectors) {
      const el = root.querySelector(s);
      if (el && text(el)) return el;
    }
    return null;
  };
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content")?.trim() || "";
  const htmlToText = (html) => {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(String(html).replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "$&\n"), "text/html");
    return (doc.body.textContent || "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  /** schema.org JobPosting data (Naukri, Glassdoor, Foundit, many company career sites). */
  function jsonLdJob() {
    const found = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const type = node["@type"];
      if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) found.push(node);
      if (node["@graph"]) walk(node["@graph"]);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { walk(JSON.parse(s.textContent || "")); } catch { /* not JSON */ }
    }
    const job = found[0];
    if (!job) return null;
    const org = job.hiringOrganization;
    const places = [].concat(job.jobLocation || []).map((l) => {
      const a = (l && l.address) || {};
      return typeof a === "string" ? a : [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)]
        .filter((v) => v && typeof v === "string").join(", ");
    }).filter(Boolean);
    const salary = job.baseSalary && job.baseSalary.value;
    const salaryText = salary && typeof salary === "object"
      ? [salary.minValue, salary.maxValue].filter(Boolean).join("-") + (job.baseSalary.currency ? ` ${job.baseSalary.currency}` : "") + (salary.unitText ? ` per ${String(salary.unitText).toLowerCase()}` : "")
      : "";
    const exp = job.experienceRequirements;
    return {
      title: String(job.title || "").trim(),
      company: String((org && (org.name || org)) || "").trim(),
      location: [...new Set(places)].join(" / "),
      workplace: /TELECOMMUTE/i.test(String(job.jobLocationType || "")) ? "Remote" : "",
      posted: String(job.datePosted || "").slice(0, 10),
      salary: salaryText.trim(),
      experience: typeof exp === "string" ? exp : exp && exp.monthsOfExperience ? `${Math.round(exp.monthsOfExperience / 12)}+ years` : "",
      description: htmlToText(job.description),
    };
  }

  /** Portal pages without JobPosting data (or with less than the page shows). */
  const PAGE = [
    { host: /linkedin\.com$/,
      title: [".job-details-jobs-unified-top-card__job-title h1", ".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title", "h1"],
      company: [".job-details-jobs-unified-top-card__company-name a", ".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link", ".topcard__flavor"],
      location: [".job-details-jobs-unified-top-card__primary-description-container .tvm__text", ".job-details-jobs-unified-top-card__bullet", ".topcard__flavor--bullet"],
      description: ["#job-details", ".jobs-description__content", ".jobs-box__html-content", ".show-more-less-html__markup", ".description__text"] },
    { host: /naukri\.com$/,
      title: ["h1[class*='jd-header-title']", "h1"],
      company: ["[class*='jd-header-comp-name'] a", "[class*='jd-header-comp-name']", ".jd-header-comp-name a"],
      location: ["[class*='jhc__location']", ".location"],
      experience: ["[class*='jhc__exp']", ".exp"],
      salary: ["[class*='jhc__salary']", ".salary"],
      description: ["[class*='JDC__dang-inner-html']", "[class*='job-desc']", ".job-desc"] },
    { host: /indeed\./,
      title: ["[data-testid='jobsearch-JobInfoHeader-title']", "h1"],
      company: ["[data-testid='inlineHeader-companyName']", "[data-company-name]", "[data-testid='jobsearch-CompanyInfoContainer'] a"],
      location: ["[data-testid='inlineHeader-companyLocation']", "[data-testid='job-location']", "[data-testid='jobsearch-JobInfoHeader-companyLocation']"],
      salary: ["#salaryInfoAndJobType", "[data-testid='jobsearch-OtherJobDetailsContainer']"],
      description: ["#jobDescriptionText"] },
    { host: /glassdoor\./,
      title: ["[data-test='job-title']", "h1"], company: ["[data-test='employer-name']", "[class*='EmployerProfile_employerName']"],
      location: ["[data-test='location']"], description: ["[class*='JobDetails_jobDescription']", "#JobDescriptionContainer"] },
    { host: /foundit\.in$/,
      title: ["h1"], company: ["[class*='companyName']", ".company-name"], location: ["[class*='location']"], description: ["[class*='jobDescInfo']", "[class*='job-description']"] },
    { host: /(instahyre\.com|wellfound\.com|cutshort\.io|hirist\.tech|iimjobs\.com)$/,
      title: ["h1"], company: ["[class*='company-name']", "[class*='companyName']", "[class*='company'] a"], location: ["[class*='location']"],
      description: ["[class*='job-description']", "[class*='jobDescription']", "[class*='description']"] },
  ];

  /** The posting's own link: LinkedIn / Indeed search pages show a job by id in the URL. */
  function jobUrl() {
    const u = new URL(location.href);
    if (/linkedin\.com$/.test(u.hostname)) {
      const id = u.searchParams.get("currentJobId") || (u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,})/) || [])[1];
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    if (/indeed\./.test(u.hostname)) {
      const jk = u.searchParams.get("vjk") || u.searchParams.get("jk");
      if (jk) return `${u.origin}/viewjob?jk=${jk}`;
    }
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    if (canonical && /^https?:/.test(canonical) && !/\/(jobs\/search|srp|jobs\.htm)/.test(canonical)) return canonical;
    return location.href;
  }

  /** Job boards put the company in the tab title: "Job Application for X at Acme", "Acme - X", "X @ Acme". */
  function companyFromTitle(t) {
    if (!t) return "";
    const lever = /lever\.co$/.test(location.hostname) && t.match(/^(.+?) - /);
    const m = lever || t.match(/\s(?:at|@)\s+(.+?)(?:\s+[|–—-]\s+.*)?$/);
    return m ? m[1].trim() : "";
  }

  function portalName(host) {
    const names = [["linkedin", "LinkedIn"], ["naukri", "Naukri"], ["indeed", "Indeed"], ["foundit", "Foundit"], ["glassdoor", "Glassdoor"],
      ["instahyre", "Instahyre"], ["wellfound", "Wellfound"], ["cutshort", "Cutshort"], ["hirist", "Hirist"], ["iimjobs", "iimjobs"]];
    const hit = names.find(([k]) => host.includes(k));
    return hit ? hit[1] : host.replace(/^www\./, "");
  }

  /** The job on this page: { title, company, location, workplace, experience, salary, posted, url, portal, description }. */
  function detail() {
    const host = location.hostname;
    const ld = jsonLdJob() || {};
    const rules = PAGE.find((r) => r.host.test(host)) || {};
    const pick = (field) => (rules[field] ? text(first(rules[field])) : "");
    const onPortal = PORTAL_HOSTS.test(host);
    let title = ld.title || pick("title");
    let company = ld.company || pick("company");
    let description = pick("description");
    if (ld.description && ld.description.length > description.length) description = ld.description;
    if (!onPortal) { // a company careers page
      title = title || text(document.querySelector("h1")) || meta("og:title");
      company = company || companyFromTitle(document.title) || companyFromTitle(meta("og:title")) || meta("og:site_name");
      description = description || text(document.querySelector("main, article, [role='main']")) || text(document.body);
    }
    const location_ = ld.location || pick("location");
    const all = `${location_} ${pick("location")} ${description.slice(0, 600)}`;
    return {
      title: title.split("\n")[0].trim().slice(0, 300),
      company: company.split("\n")[0].replace(/\s*[·•|].*$/, "").trim().slice(0, 200),
      location: location_.split("\n")[0].replace(/\s*[·•]\s*\d+\s+(days?|weeks?|hours?|months?) ago.*$/i, "").trim().slice(0, 300),
      workplace: ld.workplace || (/\bremote\b/i.test(all) ? "Remote" : /\bhybrid\b/i.test(all) ? "Hybrid" : /\bon-?site\b/i.test(all) ? "Onsite" : ""),
      experience: ld.experience || pick("experience"),
      salary: ld.salary || pick("salary"),
      posted: ld.posted || "",
      url: jobUrl(),
      portal: portalName(host),
      description: description.slice(0, MAX_JD),
    };
  }

  /** Links to job postings on a portal's search results page (for the collector). */
  const LINKS = [
    [/linkedin\.com$/, "a[href*='/jobs/view/']", (h) => { const id = (h.match(/\/jobs\/view\/(?:[^/?]*-)?(\d{6,})/) || [])[1]; return id && `https://www.linkedin.com/jobs/view/${id}/`; }],
    [/naukri\.com$/, "a[href*='/job-listings-']", (h) => h.split("?")[0]],
    [/indeed\./, "a[data-jk], a[href*='jk=']", (h, a) => { const jk = a.getAttribute("data-jk") || new URL(h).searchParams.get("jk"); return jk && `${location.origin}/viewjob?jk=${jk}`; }],
    [/foundit\.in$/, "a[href*='/job/']", (h) => h.split("?")[0]],
    [/glassdoor\./, "a[href*='/job-listing/']", (h) => h],
    [/instahyre\.com$/, "a[href*='/job-']", (h) => h.split("?")[0]],
    [/wellfound\.com$/, "a[href*='/jobs/']", (h) => (/\/jobs\/\d+/.test(h) ? h.split("?")[0] : null)],
    [/cutshort\.io$/, "a[href*='/job/']", (h) => h.split("?")[0]],
    [/(hirist\.tech|iimjobs\.com)$/, "a[href*='/j/']", (h) => h.split("?")[0]],
  ];
  function searchLinks() {
    const rule = LINKS.find(([host]) => host.test(location.hostname));
    if (!rule) return [];
    const out = [];
    for (const a of document.querySelectorAll(rule[1])) {
      let url = null;
      try { url = rule[2](new URL(a.getAttribute("href") || "", location.href).href, a); } catch { url = null; }
      if (url && !out.includes(url)) out.push(url);
    }
    return out;
  }

  globalThis.ciExtract = { detail, searchLinks, jsonLdJob };
})();
