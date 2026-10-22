import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CvTailor, type AtsReport } from "../features/jobs/CvTailor";
import { mockApi, renderAt } from "./utils";

const report = (score: number, statuses: Record<string, string>): AtsReport => ({
  score, title: "Senior PHP Developer", title_words_missing: [], experience_required: 8, experience_found: 12, notes: [],
  parts: { required: { earned: 21.9, max: 50 }, title: { earned: 15, max: 15 } },
  keywords: Object.entries(statuses).map(([skill, status]) => ({
    skill, importance: "required", status: status as AtsReport["keywords"][0]["status"],
    via: status === "implied" ? "Magento 2" : status === "related" ? "MariaDB" : null,
  })),
});
const BEFORE = report(62, { PHP: "found", Magento: "implied", MySQL: "related", GraphQL: "missing" });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function upload(name: string) {
  const input = screen.getByLabelText(/Your CV/);
  fireEvent.change(input, { target: { files: [new File(["x"], name)] } });
}

describe("CvTailor", () => {
  it("scores the CV, pre-ticks implied skills only, and downloads the tailored DOCX", async () => {
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:cv"), revokeObjectURL: vi.fn() }));
    const api = mockApi({
      "POST /jobs/7/cv-check": { format: "docx", can_edit: true, report: BEFORE, suggested: ["Magento"] },
      "POST /jobs/7/cv-tailor": {
        before: BEFORE, after: report(78, { PHP: "found", Magento: "found", MySQL: "related", GraphQL: "found" }),
        added: ["Magento", "GraphQL"], not_added: [], reordered_lines: 1, headline: null, notes: [],
        filename: "cv-Acme.docx", content_base64: btoa("docx"),
      },
    });
    renderAt(<CvTailor jobId={7} />);
    upload("cv.docx");
    expect(await screen.findByText("62 / 100")).toBeInTheDocument();
    expect(screen.getByText(/In your CV:/).parentElement).toHaveTextContent("PHP");
    expect(screen.getByRole("checkbox", { name: /Magento/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /MySQL/ })).not.toBeChecked(); // related: user decides
    expect(screen.getByRole("checkbox", { name: /GraphQL/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: /GraphQL/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create tailored CV (DOCX)" }));

    expect(await screen.findByText(/Score 62 →/)).toHaveTextContent("Score 62 → 78. Downloaded cv-Acme.docx.");
    const sent = api.calls.find((c) => c.path === "/jobs/7/cv-tailor")?.body as FormData;
    expect(sent.getAll("add")).toEqual(["Magento", "GraphQL"]);
    expect(sent.get("use_title")).toBe("false");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Still not in your CV: MySQL/)).toBeInTheDocument();
  });

  it("a PDF is tailored as a plain Word copy, and says so", async () => {
    mockApi({ "POST /jobs/7/cv-check": { format: "pdf", can_edit: true, builds_copy: true, report: BEFORE, suggested: [] } });
    renderAt(<CvTailor jobId={7} />);
    upload("cv.pdf");
    expect(await screen.findByText(/From a PDF, you get a Word copy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create tailored Word copy (DOCX)" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /GraphQL/ })).toBeEnabled();
  });
});
