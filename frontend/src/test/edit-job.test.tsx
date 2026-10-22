import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditJob, amountReadout, changedFields, parseAmount } from "../features/jobs/EditJob";
import { WorkModelPicker } from "../features/jobs/JobFields";
import type { JobDetail } from "../types/api";
import { mockApi, renderAt } from "./utils";

const JOB = {
  id: 7, title: "Magento Lead", location: "Bengaluru", work_model: "UNKNOWN", employment_type: null,
  experience_min: "8.0", experience_max: null, salary_min: null, salary_max: null, salary_currency: null,
  posting_date: null, application_deadline: null, original_jd: "Build things", notes: null,
  company: { id: 1, name: "Acme" }, source_url: "https://acme.example/jobs/old",
  source_links: [{ id: 1, source: "COMPANY_SITE", original_url: "https://acme.example/jobs/old" }],
} as unknown as JobDetail;

afterEach(() => vi.unstubAllGlobals());

describe("EditJob", () => {
  it("sends only what changed: location, work model and job type", async () => {
    const api = mockApi({ "PATCH /jobs/7": JOB, "GET /preferences": { preferred_locations: ["Pune"] }, "GET /applications": { items: [], total: 0 } });
    const done = vi.fn();
    renderAt(<EditJob job={JOB} onDone={done} />);
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled(); // nothing changed yet
    fireEvent.change(screen.getByLabelText(/Location/), { target: { value: "Pune, India" } });
    fireEvent.click(screen.getByRole("radio", { name: "Hybrid" }));
    fireEvent.change(screen.getByLabelText("Job type"), { target: { value: "Contract" } });
    fireEvent.click(save);
    await waitFor(() => expect(done).toHaveBeenCalled());
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ location: "Pune, India", work_model: "HYBRID", employment_type: "Contract" });
    expect(api.calls.some((c) => c.method === "POST")).toBe(false); // applied date untouched
  });

  it("changes the job link, and refuses text that isn't one", async () => {
    const api = mockApi({ "PATCH /jobs/7": JOB, "GET /preferences": {}, "GET /applications": { items: [], total: 0 } });
    const done = vi.fn();
    renderAt(<EditJob job={JOB} onDone={done} />);
    const link = screen.getByLabelText(/Job link/);
    expect(link).toHaveValue("https://acme.example/jobs/old");
    fireEvent.change(link, { target: { value: "not a link" } });
    expect(screen.getByText(/Paste the posting's web address/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(link, { target: { value: "https://careers.acme.example/jobs/42" } });
    expect(screen.getByText(/Changed: Job link/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ url: "https://careers.acme.example/jobs/42" });
  });

  it("corrects the applied date of an automatic application", async () => {
    const api = mockApi({
      "GET /preferences": {}, "PATCH /applications/3": {},
      "GET /applications": { items: [{ id: 3, applied_on: "2026-10-12", origin: "auto" }], total: 1 },
    });
    const done = vi.fn();
    renderAt(<EditJob job={JOB} onDone={done} />);
    const date = await screen.findByDisplayValue("2026-10-12");
    expect(screen.getByText(/date is approximate/)).toBeInTheDocument();
    fireEvent.change(date, { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/applications/3", body: { applied_on: "2026-10-01" } });
    expect(api.calls.some((c) => c.path === "/jobs/7")).toBe(false); // nothing else changed
  });

  it("records an application when a date is picked for a job not applied yet", async () => {
    const api = mockApi({ "GET /preferences": {}, "POST /applications": {}, "GET /applications": { items: [], total: 0 } });
    renderAt(<EditJob job={JOB} onDone={vi.fn()} />);
    expect(await screen.findByText(/records an application/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Applied on/), { target: { value: "2026-10-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ job_id: 7, applied_on: "2026-10-02" }));
  });

  it("refuses a future applied date", async () => {
    mockApi({ "GET /preferences": {}, "GET /applications": { items: [], total: 0 } });
    renderAt(<EditJob job={JOB} onDone={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Applied on/), { target: { value: "2999-01-01" } });
    expect(screen.getByText("The applied date can't be in the future")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("clears values with null and converts numbers", () => {
    const before = { title: "A", url: "", location: "Pune", work_model: "REMOTE", employment_type: "", experience_min: "8", experience_max: "",
      salary_min: "", salary_max: "", salary_currency: "", salary_text: "", posting_date: "", application_deadline: "", original_jd: "x", notes: "",
      required_skills: [], preferred_skills: [] };
    expect(changedFields(before, { ...before, location: "", work_model: "", experience_max: "12", salary_currency: "inr" }))
      .toEqual({ location: null, work_model: null, experience_max: 12, salary_currency: "INR" });
  });
});

describe("EditJob salary, skills and checks", () => {
  it("reads salary shorthand and shows it in lakhs", () => {
    expect(parseAmount("30L")).toBe(3000000);
    expect(parseAmount("30 LPA")).toBe(3000000);
    expect(parseAmount("1.2Cr")).toBe(12000000);
    expect(parseAmount("30,00,000")).toBe(3000000);
    expect(parseAmount("50k")).toBe(50000);
    expect(parseAmount("lots")).toBeNull();
    expect(parseAmount(" ")).toBeUndefined();
    expect(amountReadout("30L", "")).toBe("₹30 LPA · 3,000,000 a year");
    expect(amountReadout("120000", "usd")).toBe("120,000 USD a year");
  });

  it("saves typed salary and edited skills", async () => {
    const api = mockApi({ "PATCH /jobs/7": JOB, "GET /preferences": {}, "GET /applications": { items: [], total: 0 } });
    const done = vi.fn();
    renderAt(<EditJob job={{ ...JOB, required_skills: ["PHP"], preferred_skills: [] } as JobDetail} onDone={done} />);
    fireEvent.change(screen.getByLabelText(/^Salary from/), { target: { value: "30L" } });
    expect(screen.getByText("₹30 LPA · 3,000,000 a year")).toBeInTheDocument();
    const skills = screen.getByRole("textbox", { name: "Required skills" });
    fireEvent.change(skills, { target: { value: "Magento" } });
    fireEvent.keyDown(skills, { key: "Enter" });
    expect(screen.getByText(/Changed: Salary, Required skills/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ salary_min: 3000000, required_skills: ["PHP", "Magento"] });
  });

  it("marks a range that runs backwards and undoes changes", async () => {
    mockApi({ "GET /preferences": {}, "GET /applications": { items: [], total: 0 } });
    renderAt(<EditJob job={JOB} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Experience to (years)"), { target: { value: "5" } });
    expect(screen.getByText("Must be at least the “from” value")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Undo changes" }));
    expect(screen.getByLabelText("Experience to (years)")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Undo changes" })).not.toBeInTheDocument();
  });
});

describe("WorkModelPicker", () => {
  it("shows Not stated for UNKNOWN and reports the choice", () => {
    const change = vi.fn();
    renderAt(<WorkModelPicker value="UNKNOWN" onChange={change} />);
    expect(screen.getByRole("radio", { name: "Not stated" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Remote" }));
    expect(change).toHaveBeenCalledWith("REMOTE");
  });
});
