import type { PageInspection } from "@scopepilot/contracts/audit";
import { describe, expect, it } from "vitest";
import { buildAuditAnalysis } from "../src/analysis.js";
import { guardModule } from "../src/findings.js";
import { runPerformanceAnalysis } from "../src/performance.js";

const ROOT = "https://example.com/";
const home: PageInspection = {
  url: ROOT, title: null, metaDescription: "Home", headings: [{ level: 1, text: "Home" }], canonical: ROOT, robots: null,
  links: [], images: [], httpStatus: 200, finalUrl: ROOT, xRobotsTag: null, warnings: [],
};
const axeOutput = { engineVersion: "4.14.0", violations: [{ id: "html-has-lang", impact: "serious", description: "d", help: "<html> element must have a lang attribute", helpUrl: "https://dequeuniversity.com/rules/axe/4.14/html-has-lang", tags: ["wcag2a", "wcag311"], nodes: [{ target: ["html"], html: "<html>" }] }], incompleteRuleIds: [], passedRuleCount: 1, inapplicableRuleCount: 1 };

describe("buildAuditAnalysis", () => {
  it("combines module results, keeps measurements per module and sorts findings by severity", async () => {
    const performance = await runPerformanceAnalysis({ url: ROOT, apiKey: undefined, strategies: ["desktop"] });
    const analysis = buildAuditAnalysis({ rootUrl: ROOT, pages: [home], performance, accessibility: { enabled: true, pages: [{ url: ROOT, status: "completed", raw: axeOutput }] } });

    expect(analysis.modules.seo.status).toBe("completed");
    expect(analysis.modules.performance.status).toBe("unavailable");
    expect(analysis.modules.accessibility.status).toBe("completed");
    expect(analysis.findings.map((finding) => [finding.category, finding.severity])).toEqual([["accessibility", "high"], ["seo", "high"]]);
    expect(analysis).not.toHaveProperty("score");
  });

  it("isolates an unexpected module failure and keeps other modules' results", async () => {
    const performance = await runPerformanceAnalysis({ url: ROOT, apiKey: undefined, strategies: ["desktop"] });
    const analysis = buildAuditAnalysis({ rootUrl: "not a url", pages: [home], performance, accessibility: { enabled: true, pages: [{ url: ROOT, status: "completed", raw: axeOutput }] } });

    expect(analysis.modules.seo).toMatchObject({ status: "failed", measurements: null, findingCount: 0, issues: [{ code: "ANALYSIS_ERROR" }] });
    expect(analysis.modules.accessibility.status).toBe("completed");
    expect(analysis.findings.map((finding) => finding.category)).toEqual(["accessibility"]);
  });
});

describe("guardModule", () => {
  it("returns a failed module without leaking the exception message", () => {
    const result = guardModule(() => { throw new Error("secret internal detail"); }, ["note"]);
    expect(result.run).toMatchObject({ status: "failed", measurements: null, notes: ["note"], findingCount: 0 });
    expect(JSON.stringify(result)).not.toContain("secret internal detail");
  });
});
