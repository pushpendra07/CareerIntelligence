// Reads job postings from the page the user is looking at. Injected by the extension into the
// current tab (popup: "add this job") or into a portal tab (collector). Defines
// globalThis.ciExtract = { detail(), searchLinks() }. Read-only: never clicks or submits anything.
(() => {
  const PORTAL_HOSTS = /(^|\.)(linkedin\.com|naukri\.com|indeed\.[a-z.]+|foundit\.[a-z.]+|monsterindia\.com|shine\.com|timesjobs\.com|glassdoor\.[a-z.]+|instahyre\.com|wellfound\.com|cutshort\.io|hirist\.(tech|com)|iimjobs\.com|apna\.co|internshala\.com|freshersworld\.com|updazz\.com)$/;
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
    { host: /(foundit\.[a-z.]+|monsterindia\.com)$/,
      title: ["[class*='jdTitle' i]", "h1"], company: ["[class*='jdCompanyName' i]", "[class*='companyName' i] a", "[class*='companyName' i]", ".company-name"],
      location: ["[class*='location' i]"], experience: ["[class*='experience' i]"], salary: ["[class*='salary' i]"],
      description: ["[class*='jobDescInfo' i]", "[class*='jdDescription' i]", "[class*='job-description' i]"] },
    { host: /shine\.com$/,
      title: ["h1[class*='jobDetail' i]", "[class*='jobTitle' i] h1", "h1"],
      company: ["[class*='companyName' i] a", "[class*='companyName' i]", "[class*='company_name' i]", "[class*='jobDetail' i] h2"],
      location: ["[class*='location' i]"], experience: ["[class*='experience' i]", "[class*='exp' i]"], salary: ["[class*='salary' i]"],
      description: ["[class*='jobDescription' i]", "[class*='jobDetailDesc' i]", "[class*='job_description' i]", "[class*='jd' i]"] },
    { host: /timesjobs\.com$/,
      title: ["h1.jd-job-title", "h1"], company: [".jd-header h2", "[class*='company' i]"], location: [".jd-header .top-jd-dtl li:last-child", "[class*='location' i]"],
      experience: [".jd-header .top-jd-dtl li:first-child"], description: [".jd-desc", "[class*='job-description' i]"] },
    { host: /(instahyre\.com|wellfound\.com|cutshort\.io|hirist\.(tech|com)|iimjobs\.com|apna\.co|internshala\.com|freshersworld\.com|monsterindia\.com|updazz\.com)$/,
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
    if (/glassdoor\./.test(u.hostname)) {
      const jl = u.searchParams.get("jl") || u.searchParams.get("jobListingId");
      if (jl) return `${u.origin}/job-listing/j?jl=${jl}`;
    }
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    if (canonical && /^https?:/.test(canonical) && !LISTING.test(canonical)) return cleanUrl(canonical);
    return cleanUrl(location.href);
  }

  /** Search results pages: many jobs, none of them the one to add. */
  const LISTING = /\/(jobs\/search|jobs\/collections|srp|job-search|search-jobs|jobs\.htm|jobs\?|q-)|\/[^/?#]*-jobs(-in-[^/?#]*)?\/?($|\?)|[?&](q|k|query|keywords?)=/i;
  /** On a search page with no job selected the popup asks the user to open one job. */
  function isListing(url) {
    return LISTING.test(location.href) && url === cleanUrl(location.href);
  }

  /** A portal link with the posting ID in its path needs no query (src=, sid=, xp=… tracking). */
  const TRACKING = /^(utm_.*|src|sid|xid|xp|px|trk|trkInfo|trackingId|refId|ref|lipi|from|source|campaign|origin|searchId|sort)$/i;
  function cleanUrl(href) {
    try {
      const u = new URL(href);
      u.hash = /^#\/?jobs?\//.test(u.hash) ? u.hash : "";
      if (PORTAL_HOSTS.test(u.hostname) && /\d{6,}/.test(u.pathname)) u.search = "";
      else for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
      return u.href;
    } catch { return href; }
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
      ["instahyre", "Instahyre"], ["wellfound", "Wellfound"], ["cutshort", "Cutshort"], ["hirist", "Hirist"], ["iimjobs", "iimjobs"],
      ["shine", "Shine"], ["timesjobs", "TimesJobs"], ["monsterindia", "Foundit"], ["apna", "Apna"], ["internshala", "Internshala"],
      ["freshersworld", "Freshersworld"], ["updazz", "Updazz"]];
    const hit = names.find(([k]) => host.includes(k));
    return hit ? hit[1] : host.replace(/^www\./, "");
  }

  const PORTAL_WORDS = /^(linkedin|naukri(\.com)?|indeed(\.com)?|foundit(\.in)?|monster(india)?|shine(\.com)?|timesjobs(\.com)?|glassdoor|instahyre|wellfound|cutshort|hirist|iimjobs(\.com)?|apna|internshala|freshersworld|updazz|jobs?|careers?|job description|job details|apply now|hiring)$/i;
  /** "Senior PHP Developer | Acme | LinkedIn", "PHP Developer - Acme Pvt Ltd - 3 to 5 years - Naukri.com":
   *  the parts left after dropping the portal's own words; [title, company]. */
  function titleParts(t) {
    if (!t) return [];
    return t.replace(/^\(\d+\)\s*/, "").split(/\s+[|–—]\s+|\s+-\s+/)
      .map((p) => p.replace(/\s*(job description|job opening|jobs?) in .*$/i, "").replace(/\s*-?\s*job description$/i, "").trim())
      .filter((p) => p && !PORTAL_WORDS.test(p) && !/\d+\s*(to|-)\s*\d+\s*(yrs?|years?)|years? of experience|^\d+ jobs?\b/i.test(p));
  }

  /** A section of the page under a heading like "About the job" / "Job description". */
  function sectionText() {
    const heads = [...document.querySelectorAll("h1, h2, h3, h4, strong, [class*='heading' i], [class*='title' i]")]
      .filter((h) => /^(about the (job|role)|job description|description|job details|role overview|job summary|responsibilities)\s*:?$/i.test(text(h)));
    for (const h of heads) {
      for (let el = h.parentElement, i = 0; el && el !== document.body && i < 4; el = el.parentElement, i++) {
        const t = text(el);
        if (t.length > 300) return t;
      }
    }
    return "";
  }

  /** Company links/labels most portals put next to the job title. */
  const COMPANY_GUESS = ["[data-company-name]", "[data-testid*='company' i]", "a[href*='/company/']", "a[href*='/companies/']",
    "a[href*='-jobs-careers-']", "[class*='company-name' i]", "[class*='companyName' i]", "[itemprop='hiringOrganization']"];
  function companyGuess() {
    for (const sel of COMPANY_GUESS) {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.getAttribute("data-company-name") || text(el)).split("\n")[0].trim();
        if (t && t.length <= 80 && !/^(follow|view|see|jobs?|company)\b/i.test(t)) return t;
      }
    }
    return "";
  }

  const EXPERIENCE = /\b\d{1,2}\s*(?:-|–|to)\s*\d{1,2}\s*(?:yrs?|years?)\b|\b\d{1,2}\+?\s*(?:yrs?|years?)(?: of)? experience\b/i;

  /** The job on this page: { title, company, location, workplace, experience, salary, posted, url, portal, description, listing }. */
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
      description = description || sectionText() || text(document.querySelector("main, article, [role='main']")) || text(document.body);
    } else { // a portal whose layout changed: the tab title, company links, the "About the job" section
      const parts = titleParts(document.title).length ? titleParts(document.title) : titleParts(meta("og:title"));
      title = title || parts[0] || text(document.querySelector("h1"));
      company = company || companyGuess() || parts[1] || "";
      description = description || sectionText();
    }
    const location_ = ld.location || pick("location");
    const all = `${location_} ${pick("location")} ${description.slice(0, 600)}`;
    const url = jobUrl();
    return {
      title: title.split("\n")[0].trim().slice(0, 300),
      company: company.split("\n")[0].replace(/\s*[·•|].*$/, "").trim().slice(0, 200),
      location: location_.split("\n")[0].replace(/\s*[·•]\s*\d+\s+(days?|weeks?|hours?|months?) ago.*$/i, "").trim().slice(0, 300),
      workplace: ld.workplace || (/\bremote\b/i.test(all) ? "Remote" : /\bhybrid\b/i.test(all) ? "Hybrid" : /\bon-?site\b/i.test(all) ? "Onsite" : ""),
      experience: ld.experience || pick("experience") || ((`${pick("experience")} ${description.slice(0, 1500)}`.match(EXPERIENCE) || [])[0] || ""),
      salary: ld.salary || pick("salary"),
      posted: ld.posted || "",
      url,
      portal: portalName(host),
      description: description.slice(0, MAX_JD),
      listing: !ld.title && isListing(url),
    };
  }

  /** Links to job postings on a portal's search results page (for the collector). */
  const LINKS = [
    [/linkedin\.com$/, "a[href*='/jobs/view/']", (h) => { const id = (h.match(/\/jobs\/view\/(?:[^/?]*-)?(\d{6,})/) || [])[1]; return id && `https://www.linkedin.com/jobs/view/${id}/`; }],
    [/naukri\.com$/, "a[href*='/job-listings-']", (h) => h.split("?")[0]],
    [/indeed\./, "a[data-jk], a[href*='jk=']", (h, a) => { const jk = a.getAttribute("data-jk") || new URL(h).searchParams.get("jk"); return jk && `${location.origin}/viewjob?jk=${jk}`; }],
    [/(foundit\.[a-z.]+|monsterindia\.com)$/, "a[href*='/job/']", (h) => h.split("?")[0]],
    [/shine\.com$/, "a[href*='/jobs/']", (h) => (/\/jobs\/[^?]*\d{6,}/.test(h) ? h.split("?")[0] : null)],
    [/timesjobs\.com$/, "a[href*='job-detail']", (h) => h],
    [/glassdoor\./, "a[href*='/job-listing/']", (h) => h],
    [/instahyre\.com$/, "a[href*='/job-']", (h) => h.split("?")[0]],
    [/wellfound\.com$/, "a[href*='/jobs/']", (h) => (/\/jobs\/\d+/.test(h) ? h.split("?")[0] : null)],
    [/cutshort\.io$/, "a[href*='/job/']", (h) => h.split("?")[0]],
    [/(hirist\.(tech|com)|iimjobs\.com)$/, "a[href*='/j/']", (h) => h.split("?")[0]],
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
