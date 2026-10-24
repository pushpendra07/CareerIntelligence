import source from "../../../browser-extension/autofill.js?raw";
import { afterEach, describe, expect, it, vi } from "vitest";

type Result = { filled: string[]; cvAttached: boolean; fileFieldFound: boolean };
type Autofill = { hasForm: () => boolean; wantsCv: () => boolean; fill: (kit: unknown, cv: File | null) => Result;
  follow: (kit: unknown, cv: File | null) => Result; stop: () => void; following: () => boolean };
const load = (): Autofill => {
  new Function(source)();
  return (globalThis as unknown as { ciAutofill: Autofill }).ciAutofill;
};
const val = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;

const KIT = {
  applicant: { first_name: "Asha", last_name: "Verma", full_name: "Asha Verma", email: "asha@example.com", phone: "+91 90000 00000",
    linkedin: "https://www.linkedin.com/in/asha", city: "Pune", current_ctc: "28 LPA", expected_ctc: "35 LPA",
    notice_period: "60 days", relocate: "Yes", total_experience: "12", current_company: "Acme", github: "" },
  labels: { first_name: "First name", last_name: "Last name", email: "Email", phone: "Phone", linkedin: "LinkedIn",
    current_ctc: "Current CTC", expected_ctc: "Expected CTC", notice_period: "Notice period", relocate: "Willing to relocate", city: "City" },
  answers: [{ question: "Why do you want to join Acme?", answer: "Commerce at scale." }],
  cover_note: "Hello, I lead Magento teams.",
};

afterEach(() => { document.body.innerHTML = ""; });

describe("Apply: filling an application form", () => {
  it("fills empty fields it recognises, never overwrites, never submits", () => {
    document.body.innerHTML = `<form id="application">
      <label for="first_name">First Name *</label><input id="first_name" name="first_name">
      <label for="last_name">Last Name *</label><input id="last_name" name="last_name">
      <label for="email">Email *</label><input id="email" type="email">
      <label for="phone">Phone</label><input id="phone" type="tel" value="98765 43210">
      <label>LinkedIn Profile <input name="question_1"></label>
      <div><label for="q2">What is your current CTC?</label><input id="q2"></div>
      <div><label for="q3">Expected salary</label><input id="q3"></div>
      <div><label for="q4">Notice period</label><select id="q4"><option value="">Select</option><option value="30">30 days</option><option value="60">60 days</option></select></div>
      <div><label for="q5">Why do you want to join Acme?</label><textarea id="q5"></textarea></div>
      <div><label for="q6">Cover Letter</label><textarea id="q6"></textarea></div>
      <div><label for="q7">Company name of your referrer</label><input id="q7"></div>
      <div style="display:none"><label for="h">First name</label><input id="h"></div>
      <label for="resume">Resume/CV</label><input id="resume" type="file">
      <button type="submit" id="go">Submit application</button>
    </form>`;
    let submitted = false;
    document.getElementById("application")!.addEventListener("submit", () => { submitted = true; });
    const a = load();
    expect(a.hasForm()).toBe(true);
    const r = a.fill(KIT, null);
    expect([val("#first_name"), val("#last_name"), val("#email")]).toEqual(["Asha", "Verma", "asha@example.com"]);
    expect(val("#phone")).toBe("98765 43210"); // already filled: kept
    expect(val('[name="question_1"]')).toBe("https://www.linkedin.com/in/asha");
    expect([val("#q2"), val("#q3"), val("#q4")]).toEqual(["28 LPA", "35 LPA", "60"]);
    expect(val("#q5")).toBe("Commerce at scale."); // your own saved answer
    expect(val("#q6")).toBe("Hello, I lead Magento teams.");
    expect(val("#q7")).toBe(""); // "company name of your referrer" is not your name or company
    expect(val("#h")).toBe(""); // hidden fields are left alone
    expect(r.filled).toEqual(expect.arrayContaining(["First name", "Email", "Current CTC", "Why do you want to join Acme?", "Cover note"]));
    expect(r.fileFieldFound).toBe(true);
    expect(submitted).toBe(false);
  });

  it("says when a page has no application form", () => {
    document.body.innerHTML = `<main><h1>Magento Lead</h1><p>Apply on our careers site.</p><input type="search" placeholder="Search jobs"></main>`;
    expect(load().hasForm()).toBe(false);
  });

  it("fills name parts, address, salary negotiable and the message to the recruiter", () => {
    document.body.innerHTML = `<form>
      <label for="fn">First name</label><input id="fn">
      <label for="mn">Middle name</label><input id="mn">
      <label for="ln">Last name</label><input id="ln">
      <label for="em">Email address</label><input id="em">
      <label for="a1">Address line 1</label><input id="a1">
      <label for="a2">Address line 2</label><input id="a2">
      <label for="ci">City</label><input id="ci">
      <label for="st">State</label><input id="st">
      <label for="us">Are you located in the United States?</label><input id="us">
      <label for="pc">PIN code</label><input id="pc">
      <label for="cc">Phone country code</label><input id="cc">
      <label for="co">Country</label><select id="co"><option value="">Select</option><option value="IN">India</option><option value="US">United States</option></select>
      <label for="neg">Is your expected salary negotiable?</label><input id="neg">
      <label for="msg">Message to the recruiter</label><textarea id="msg"></textarea>
    </form>`;
    const kit = { ...KIT, applicant: { ...KIT.applicant, middle_name: "", address_line1: "12 MG Road", address_line2: "Flat 4",
      state: "Maharashtra", postal_code: "411001", country: "India", salary_negotiable: "Yes" } };
    load().fill(kit, null);
    expect(val("#mn")).toBe(""); // no middle name: not filled with the first name
    expect([val("#fn"), val("#ln"), val("#em")]).toEqual(["Asha", "Verma", "asha@example.com"]); // "email address" is not the address
    expect([val("#a1"), val("#a2"), val("#ci"), val("#st"), val("#pc"), val("#co")]).toEqual(["12 MG Road", "Flat 4", "Pune", "Maharashtra", "411001", "IN"]);
    expect(val("#us")).toBe(""); // "United States" is not your state
    expect(val("#cc")).toBe(""); // a country code is not your phone number
    expect(val("#neg")).toBe("Yes"); // not your expected salary
    expect(val("#msg")).toBe("Hello, I lead Magento teams.");
  });

  it("writes the date of birth the way each field wants it", () => {
    document.body.innerHTML = `<form>
      <label for="d1">Date of birth</label><input id="d1" type="date">
      <label for="d2">DOB</label><input id="d2" placeholder="DD/MM/YYYY">
      <label for="d3">Birth date</label><input id="d3" placeholder="MM-DD-YYYY">
    </form>`;
    load().fill({ ...KIT, applicant: { ...KIT.applicant, date_of_birth: "1988-03-07" } }, null);
    expect([val("#d1"), val("#d2"), val("#d3")]).toEqual(["1988-03-07", "07/03/1988", "03-07-1988"]);
  });

  it("answers Yes/No questions with radio buttons", () => {
    document.body.innerHTML = `<form>
      <fieldset><legend>Are you willing to relocate?</legend>
        <label><input type="radio" name="reloc" value="1"> Yes</label><label><input type="radio" name="reloc" value="0"> No</label></fieldset>
      <fieldset><legend>Is your salary negotiable?</legend>
        <label><input type="radio" name="neg" value="y" checked> No</label><label><input type="radio" name="neg" value="n"> Yes</label></fieldset>
    </form>`;
    const r = load().fill({ ...KIT, applicant: { ...KIT.applicant, salary_negotiable: "Yes" } }, null);
    expect((document.querySelector('[name="reloc"][value="1"]') as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector('[name="neg"][value="y"]') as HTMLInputElement).checked).toBe(true); // already chosen: kept
    expect(r.filled).toContain("Willing to relocate");
  });

  it("fills the next step of a multi-step form when it appears, and stops", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<form id="f"><label for="fn">First name</label><input id="fn"><label for="cv">Resume</label><input id="cv" type="file"></form>`;
      const a = load();
      const first = a.follow(KIT, null);
      expect(first.filled).toEqual(["First name"]);
      expect(a.following()).toBe(true);
      expect(document.querySelector("[data-ci-autofill]")).not.toBeNull(); // the on-page badge with Stop
      expect(a.wantsCv()).toBe(true);
      // You empty a filled field: it stays empty. Then step 2 appears.
      (document.getElementById("fn") as HTMLInputElement).value = "";
      document.getElementById("f")!.insertAdjacentHTML("beforeend", `<label for="em">Email</label><input id="em" type="email">`);
      await vi.advanceTimersByTimeAsync(700);
      expect(val("#em")).toBe("asha@example.com");
      expect(val("#fn")).toBe("");
      a.stop();
      expect(a.following()).toBe(false);
      expect(document.querySelector("[data-ci-autofill]")).toBeNull();
      document.getElementById("f")!.insertAdjacentHTML("beforeend", `<label for="ph">Phone</label><input id="ph" type="tel">`);
      await vi.advanceTimersByTimeAsync(700);
      expect(val("#ph")).toBe(""); // stopped: nothing more is filled
    } finally {
      vi.useRealTimers();
    }
  });
});
