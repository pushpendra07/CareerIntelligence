// Fills a job application form with the apply kit from the app. Injected into the current tab
// only when the user clicks "Fill this application". Defines globalThis.ciAutofill =
// { hasForm(), fill(kit, cvFile) }. Never submits, never clicks buttons, never changes a field
// that already has a value: the user checks everything and presses Submit.
(() => {
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
    ["first_name", /\b(first name|given name|fname|firstname)\b/],
    ["last_name", /\b(last name|surname|family name|lname|lastname)\b/],
    ["linkedin", /linkedin/],
    ["github", /github/],
    ["portfolio", /\b(portfolio|personal (web)?site|website|blog)\b/],
    ["email", /\be ?mail\b/],
    ["phone", /\b(phone|mobile|contact number|telephone|tel)\b/],
    ["current_ctc", /\bcurrent (ctc|salary|compensation|package)\b/],
    ["expected_ctc", /\b(expected (ctc|salary|compensation|package)|salary expectation|desired salary)\b/],
    ["notice_period", /\bnotice( period)?\b|\bjoin(ing)? (in|date)\b|\bavailable to start\b/],
    ["relocate", /relocat/],
    ["work_authorization", /\b(authori[sz]ed|work permit|visa|sponsorship|right to work)\b/],
    ["total_experience", /\b(total|years of|overall) (experience|exp)\b|\bexperience \(?years\)?/],
    ["current_company", /\b(current (company|employer|organi[sz]ation)|company name)\b/],
    ["current_title", /\b(current (title|role|designation|position)|job title)\b/],
    ["city", /\b(city|current location|location|where are you based)\b/],
    ["full_name", /\b(full name|your name|candidate name|^name$|legal name)\b/],
  ];
  // About someone else (a referrer, a reference…): never filled from your details.
  const SOMEONE_ELSE = /\b(referr?(er|al|ed)?|reference|emergency|manager|supervisor|recruiter)\b/;
  const COVER = /\b(cover letter|why (do you want|are you interested)|additional information|message|introduce yourself|about you)\b/;
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
      if (value === null && !SOMEONE_ELSE.test(what)) {
        const rule = RULES.find(([key, rx]) => rx.test(what) && you[key]
          && !(key === "full_name" && /\b(company|employer)\b/.test(what)));
        if (rule) { value = you[rule[0]]; label = labels[rule[0]] || rule[0]; }
        else if (type === "email" && you.email) { value = you.email; label = labels.email || "Email"; }
        else if (type === "tel" && you.phone) { value = you.phone; label = labels.phone || "Phone"; }
        else if (el.tagName === "TEXTAREA" && COVER.test(what) && kit.cover_note && !used.has("cover")) {
          value = kit.cover_note; label = "Cover note"; used.add("cover");
        }
      }
      if (value === null || value === "") continue;
      if (el.tagName === "SELECT") { if (pickOption(el, value)) filled.push(label); continue; }
      setValue(el, value);
      filled.push(label);
    }
    return { filled, cvAttached, fileFieldFound: !!document.querySelector('input[type="file"]') };
  }

  globalThis.ciAutofill = { hasForm, fill, describe };
})();
