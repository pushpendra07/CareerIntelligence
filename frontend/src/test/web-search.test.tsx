import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WebSearch, companyTopic, jobTopic } from "../components/WebSearch";

const PROFILE = { effective_titles: ["Magento Architect", "Tech Lead"], required_skills: ["Magento", "PHP"],
  preferred_locations: ["Pune", "Bengaluru"], min_experience_years: "10", max_experience_years: "15" };

const href = (name: string) => new URL(screen.getByRole("link", { name }).getAttribute("href")!);

describe("web search buttons", () => {
  it("company: searches for jobs there that fit the target profile", () => {
    render(<WebSearch topic={companyTopic("Acme", PROFILE)} />);
    // No location: the company's openings anywhere.
    expect(href("Google").searchParams.get("q")).toBe('"Acme" ("Magento Architect" OR "Tech Lead") jobs');
    const ask = href("ChatGPT").searchParams.get("q")!;
    expect(ask).not.toContain("Pune");
    expect(ask).not.toContain("Locations");
    expect(ask).toContain("open job postings at Acme");
    expect(ask).toContain("Key skills: Magento, PHP.");
    expect(ask).toContain("Experience: 10–15 years.");
    expect(href("Claude").searchParams.get("q")).toBe(ask);
    expect(href("Gemini").origin).toBe("https://gemini.google.com");
  });

  it("job: looks for the same posting on other portals", () => {
    render(<WebSearch topic={jobTopic({ title: "Magento Lead", company: "Acme", location: "Pune, India", url: "https://jobs.acme.com/1" })} />);
    const google = href("Google").searchParams.get("q")!;
    expect(google).toContain('"Magento Lead" "Acme" Pune (site:linkedin.com/jobs OR site:naukri.com');
    expect(href("Claude").searchParams.get("q")).toContain("https://jobs.acme.com/1");
  });

  it("stays hidden until there is something to search for", () => {
    const { container } = render(<WebSearch topic={jobTopic({ title: "", company: "Acme" })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
