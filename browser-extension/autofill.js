// Fills a job application form with the apply kit from the app (your details are saved in the
// app: My profile -> Application details). Injected into the current tab only when the user clicks
// "Fill this application". Defines globalThis.ciAutofill = { hasForm(), wantsCv(), fill(kit, cvFile),
// follow(kit, cvFile), stop() }. Never submits, never clicks buttons (only a Yes/No choice you
// saved), never changes a field that already has a value or one you emptied after it was filled:
// the user checks everything and presses Submit. follow() also fills the next steps of a
// multi-step form as they appear, until Stop.
(() => {
  if (globalThis.ciAutofill) return; // already on this page (and maybe following the form)
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s_\-*:?()]+/g, " ").trim();

  /** What a field is asking for: its label, aria text, placeholder, name, id and autocomplete. */
  function describe(el) {
    const bits = [];
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) bits.push(lab.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) bits.push(wrap.textContent);
    const by = el.getAttribute("aria-labelledby");
    if (by) by.split(/\s+/).forEach((id) => { const n = document.getElementById(id); if (n) bits.push(n.textContent); });
    bits.push(el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("name"), el.id, el.getAttribute("autocomplete"),
      el.getAttribute("data-automation-id"), el.getAttribute("data-qa"));
    // A question written just before the field (Greenhouse/Lever custom questions).
    const box = el.closest("div, li, fieldset");
    const legend = box && box.querySelector("legend, .application-label, .text, label");
    if (legend && !legend.contains(el)) bits.push(legend.textContent);
    return norm(bits.filter(Boolean).join(" "));
  }

  // [kit key, what the field says]. First match wins; more specific rules first.
  const RULES = [
    ["salary_negotiable", /\bnegotiab/],
    ["middle_name", /\b(middle name|middle initial|mname|middlename)\b/],
    ["date_of_birth", /\b(date of birth|birth ?date|dob|birthday)\b/],
    ["first_name", /\b(first name|given name|fname|firstname)\b/],
    ["last_name", /\b(last name|surname|family name|lname|lastname)\b/],
    ["linkedin", /linkedin/],
    ["github", /github/],
    ["portfolio", /\b(portfolio|personal (web)?site|website|blog)\b/],
    ["email", /\be ?mail\b/],
    ["phone", /\b(phone|mobile|contact number|telephone|tel)\b/],
    ["postal_code", /\b(zip|zip code|postal|post code|postcode|pin ?code|pincode)\b/],
    ["state", /(?<!united )\bstate\b|\bprovince\b/],
    ["country", /\bcountry\b(?! code)/],
    ["address_line2", /\b(address line ?2|address 2|addr2|apartment|suite)\b/],
    ["current_ctc", /\bcurrent (ctc|salary|compensation|package)\b/],
    ["expected_ctc", /\b(expected (ctc|salary|compensation|package)|salary expectation|desired salary)\b/],
    ["notice_period", /\bnotice( period)?\b|\bjoin(ing)? (in|date)\b|\bavailable to start\b/],
    ["relocate", /relocat/],
    ["work_authorization", /\b(authori[sz]ed|work permit|visa|sponsorship|right to work)\b/],
    ["total_experience", /\b(total|years of|overall) (experience|exp)\b|\bexperience \(?years\)?/],
    ["current_company", /\b(current (company|employer|organi[sz]ation)|company name)\b/],
    ["current_title", /\b(current (title|role|designation|position)|job title)\b/],
    ["city", /\b(city|current location|location|where are you based)\b/],
    ["address_line1", /\b(address line ?1|address 1|street|addr1|address)\b/],
    ["full_name", /\b(full name|your name|candidate name|^name$|legal name)\b/],
  ];
  // A rule that matched but means something else here.
  const NOT_THIS = {
    full_name: /\b(company|employer)\b/,
    phone: /\b(country code|extension|ext)\b/,
    address_line1: /\b(e ?mail|ip|web)\b/,
  };
  // About someone else (a referrer, a reference…): never filled from your details.
  const SOMEONE_ELSE = /\b(referr?(er|al|ed)?|reference|emergency|manager|supervisor|recruiter)\b/;
  // …but a message *to* the recruiter is from you.
  const TO_THEM = /\b(message|note) (to|for) (the )?(recruiter|hiring)/;
  const COVER = /\b(cover letter|why (do you want|are you interested)|additional information|message|note to (the )?(recruiter|hiring)|introduce yourself|about you)\b/;
  const CV = /\b(resume|cv|curriculum)\b/;

  const fillable = (el) => {
    if (el.disabled || el.readOnly || el.type === "hidden") return false;
    if (el.type === "file") return true; // file inputs are often hidden behind a styled button
    if (el.closest("[hidden], [aria-hidden='true']")) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.display === "none" || st.visibility === "hidden") return false;
    }
    return true;
  };

  /** A saved date (YYYY-MM-DD) as the field wants it: a date picker takes it as it is; a text
   * box shows its format in the placeholder (MM/DD/YYYY), else DD/MM/YYYY as in India. */
  function asDate(iso, el) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m || el.type === "date") return iso;
    const [, y, mo, d] = m;
    const hint = norm(el.getAttribute("placeholder") || "");
    if (/^y/.test(hint)) return `${y}-${mo}-${d}`;
    const sep = (el.getAttribute("placeholder") || "").includes("-") ? "-" : "/";
    return /^mm/.test(hint) ? `${mo}${sep}${d}${sep}${y}` : `${d}${sep}${mo}${sep}${y}`;
  }

  /** Set a value the way typing would, so React/Vue forms notice it. */
  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.outline = "2px solid #10b981";
    el.style.outlineOffset = "1px";
  }

  function pickOption(select, value) {
    const want = norm(value);
    const opt = [...select.options].find((o) => norm(o.textContent) === want)
      || [...select.options].find((o) => o.value && (norm(o.textContent).includes(want) || want.includes(norm(o.textContent))));
    if (!opt || !opt.value) return false;
    setValue(select, opt.value);
    return true;
  }

  // Fields this script filled or chose: never touched again (you may have emptied one on purpose).
  const done = new WeakSet();

  /** The text of a radio button's own option ("Yes"), not the question around it. */
  function optionText(el) {
    const lab = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return norm((lab && lab.textContent) || (el.closest("label") || {}).textContent || el.getAttribute("aria-label") || el.value);
  }

  /** Radio groups: [question text, radios]. The question is the fieldset/group around them. */
  function radioGroups() {
    const groups = new Map();
    for (const el of document.querySelectorAll('input[type="radio"]')) {
      if (!fillable(el)) continue;
      const key = el.name || el.closest("fieldset, [role='radiogroup']") || el;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    }
    const out = [];
    for (const radios of groups.values()) {
      let box = radios[0].closest("fieldset, [role='radiogroup']");
      if (!box || !radios.every((r) => box.contains(r))) {
        box = radios[0].parentElement;
        while (box && !radios.every((r) => box.contains(r))) box = box.parentElement;
      }
      if (!box) continue;
      const by = box.getAttribute("aria-labelledby");
      const named = (by && document.getElementById(by)) || box.querySelector("legend");
      let question = norm(box.getAttribute("aria-label") || (named && named.textContent) || "");
      // No legend: the text just before the options (the group's container without the options).
      if (!question && box.parentElement) question = norm(box.parentElement.textContent).slice(0, 200);
      out.push([question, radios]);
    }
    return out;
  }

  function wantsCv() {
    return [...document.querySelectorAll('input[type="file"]')].some((el) => fillable(el) && !el.files?.length && !done.has(el));
  }

  function hasForm() {
    const fields = [...document.querySelectorAll("input, textarea, select")].filter(fillable);
    return fields.some((el) => el.type === "email" || el.type === "file" || /\b(e ?mail|first name|full name|resume|cv)\b/.test(describe(el)));
  }

  function fill(kit, cvFile) {
    const you = kit.applicant || {};
    const labels = kit.labels || {};
    const answers = (kit.answers || []).filter((a) => a.question && a.answer).map((a) => ({ ...a, key: norm(a.question) }));
    const filled = [];
    const used = new Set();
    let cvAttached = false;
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (!fillable(el)) continue;
      const type = (el.type || "").toLowerCase();
      if (["submit", "button", "checkbox", "radio", "image", "reset", "password", "search"].includes(type)) continue;
      if (done.has(el)) continue;
      const what = describe(el);
      if (type === "file") {
        if (cvFile && !cvAttached && !el.files?.length && (CV.test(what) || document.querySelectorAll('input[type="file"]').length === 1)) {
          try {
            const dt = new DataTransfer();
            dt.items.add(cvFile);
            el.files = dt.files;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            cvAttached = true;
            done.add(el);
            filled.push("CV");
          } catch { /* the site uses its own uploader: the user attaches the file */ }
        }
        continue;
      }
      if (el.value && el.tagName !== "SELECT") continue; // never overwrite what's there
      if (el.tagName === "SELECT" && el.selectedIndex > 0) continue;
      let value = null;
      let label = null;
      const own = answers.find((a) => a.key.length >= 8 && (what.includes(a.key) || a.key.includes(what) && what.length >= 12));
      if (own) { value = own.answer; label = own.question; }
      if (value === null && (!SOMEONE_ELSE.test(what) || TO_THEM.test(what))) {
        // The first rule that fits decides what the field is, even when that detail is empty:
        // an empty middle name must not fall through to "first name".
        const rule = RULES.find(([key, rx]) => rx.test(what) && !(NOT_THIS[key] && NOT_THIS[key].test(what)));
        if (rule) {
          if (you[rule[0]]) { value = you[rule[0]]; label = labels[rule[0]] || rule[0]; }
          if (value && rule[0] === "date_of_birth") value = asDate(value, el);
        } else if (type === "email" && you.email) { value = you.email; label = labels.email || "Email"; }
        else if (type === "tel" && you.phone) { value = you.phone; label = labels.phone || "Phone"; }
        else if (el.tagName === "TEXTAREA" && COVER.test(what) && kit.cover_note && !used.has("cover")) {
          value = kit.cover_note; label = "Cover note"; used.add("cover");
        }
      }
      if (value === null || value === "") continue;
      if (el.tagName === "SELECT") { if (pickOption(el, value)) { done.add(el); filled.push(label); } continue; }
      setValue(el, value);
      done.add(el);
      filled.push(label);
    }
    // Yes/No questions with radio buttons: pick the option matching your saved answer.
    for (const [question, radios] of radioGroups()) {
      if (!question || radios.some((r) => r.checked || done.has(r)) || SOMEONE_ELSE.test(question)) continue;
      let value = null;
      let label = null;
      const own = answers.find((a) => a.key.length >= 8 && question.includes(a.key));
      if (own) { value = own.answer; label = own.question; }
      else {
        const rule = RULES.find(([key, rx]) => rx.test(question) && you[key]);
        if (rule) { value = you[rule[0]]; label = labels[rule[0]] || rule[0]; }
      }
      if (!value) continue;
      const want = norm(value);
      const pick = radios.find((r) => optionText(r) === want) || radios.find((r) => optionText(r) && want.startsWith(optionText(r) + " "));
      if (!pick) continue;
      pick.click();
      radios.forEach((r) => done.add(r));
      filled.push(label);
    }
    return { filled, cvAttached, fileFieldFound: !!document.querySelector('input[type="file"]') };
  }

  // --- following a multi-step form ------------------------------------------------------------
  let watching = null; // { observer, timer, badge, count }

  function badge(text) {
    if (!watching) return;
    if (!watching.badge) {
      const host = document.createElement("div");
      host.setAttribute("data-ci-autofill", "");
      host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
      const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      const box = document.createElement("div");
      box.style.cssText = "max-width:300px;padding:10px 12px;border-radius:10px;background:#111827;color:#f9fafb;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3)";
      const msg = document.createElement("div");
      const stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.textContent = "Stop filling";
      stopBtn.style.cssText = "margin-top:6px;padding:3px 10px;border:1px solid #6b7280;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer";
      stopBtn.addEventListener("click", () => stop(true));
      box.append(msg, stopBtn);
      root.append(box);
      document.documentElement.append(host);
      watching.badge = { host, msg };
    }
    watching.badge.msg.textContent = text;
  }

  function badgeText() {
    const n = watching ? watching.count : 0;
    return `Career Intelligence filled ${n} field${n === 1 ? "" : "s"} (outlined green). The next steps are filled as they appear — check every field before you submit.`;
  }

  /** Fill now, then again whenever the form shows new fields (the next step), until stop(). */
  function follow(kit, cvFile) {
    const first = fill(kit, cvFile);
    let cv = first.cvAttached ? null : cvFile;
    if (watching) { watching.kit = kit; watching.count += first.filled.length; badge(badgeText()); return first; }
    watching = { kit, observer: null, timer: 0, badge: null, count: first.filled.length };
    const again = () => {
      if (!watching) return;
      const r = fill(watching.kit, cv);
      if (r.cvAttached) cv = null;
      if (r.filled.length) { watching.count += r.filled.length; badge(badgeText()); }
    };
    watching.observer = new MutationObserver((records) => {
      if (!watching || records.every((m) => watching.badge && watching.badge.host.contains(m.target))) return;
      clearTimeout(watching.timer);
      watching.timer = setTimeout(again, 600);
    });
    watching.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["hidden", "class", "aria-hidden"] });
    badge(badgeText());
    return first;
  }

  /** Stop following; byUser also tells the extension not to fill this tab's next pages. */
  function stop(byUser = false) {
    if (!watching) return;
    watching.observer.disconnect();
    clearTimeout(watching.timer);
    if (watching.badge) watching.badge.host.remove();
    watching = null;
    if (byUser) {
      try { chrome.runtime.sendMessage({ type: "autofill-stop" }).catch(() => {}); } catch { /* not in the extension */ }
    }
  }

  globalThis.ciAutofill = { hasForm, wantsCv, fill, follow, stop, following: () => !!watching, describe };
})();
