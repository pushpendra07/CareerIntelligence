import source from "../../../browser-extension/autofill.js?raw";
import { afterEach, describe, expect, it } from "vitest";

type Autofill = { hasForm: () => boolean; fill: (kit: unknown, cv: File | null) => { filled: string[]; cvAttached: boolean; fileFieldFound: boolean } };
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
});
