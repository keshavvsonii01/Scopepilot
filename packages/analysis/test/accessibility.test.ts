import { describe, expect, it } from "vitest";
import { ACCESSIBILITY_NOTES, analyzeAccessibility, wcagTags } from "../src/accessibility.js";

const URL_A = "https://example.com/";
const URL_B = "https://example.com/about";

function rawAxe(violations: unknown[] = []) {
  return { engineVersion: "4.14.0", violations, incompleteRuleIds: ["color-contrast"], passedRuleCount: 30, inapplicableRuleCount: 40 };
}

const imageAlt = {
  id: "image-alt",
  impact: "critical",
  description: "Ensure <img> elements have alternative text or a role of none or presentation",
  help: "Images must have alternative text",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.14/image-alt",
  tags: ["cat.text-alternatives", "wcag2a", "wcag111", "section508", "EN-301-549"],
  nodeCount: 12,
  nodes: Array.from({ length: 10 }, (_, index) => ({ target: [`img:nth-child(${index + 1})`], html: `<img src="/${index}.png">`, failureSummary: "Fix any of the following:\n  Element does not have an alt attribute" })),
};

const regionRule = { id: "region", impact: "moderate", description: "Ensure all page content is contained by landmarks", help: "All page content should be contained by landmarks", helpUrl: "https://dequeuniversity.com/rules/axe/4.14/region", tags: ["cat.keyboard", "best-practice"], nodes: [{ target: ["body > p"], html: "<p>Hi</p>", failureSummary: null }] };

describe("analyzeAccessibility", () => {
  it("maps axe violations to findings with rule ID, impact, WCAG tags and affected nodes", () => {
    const result = analyzeAccessibility({ enabled: true, pages: [{ url: URL_A, status: "completed", raw: rawAxe([imageAlt, regionRule]) }] });
    expect(result.run.status).toBe("completed");
    expect(result.findings).toHaveLength(2);

    const [alt, region] = result.findings;
    expect(alt).toMatchObject({
      category: "accessibility",
      severity: "critical",
      basis: "rule-based",
      affectedUrl: URL_A,
      source: { tool: "axe-core", ruleId: "image-alt", version: "4.14.0" },
      evidence: { kind: "axe-violation", ruleId: "image-alt", impact: "critical", wcagTags: ["wcag2a", "wcag111"], totalNodes: 12 },
      references: ["https://dequeuniversity.com/rules/axe/4.14/image-alt"],
    });
    expect(alt!.evidence.kind === "axe-violation" && alt!.evidence.nodes).toHaveLength(5);
    expect(alt!.explanation).toContain("12 affected elements");
    expect(alt!.remediation).toContain("does not have an alt attribute");

    expect(region).toMatchObject({ severity: "medium", evidence: { wcagTags: [] } });
    expect(region!.explanation).toContain("best-practice rule, not a WCAG success criterion");
  });

  it("stores raw measurements separately, including incomplete rules that are not findings", () => {
    const result = analyzeAccessibility({ enabled: true, pages: [{ url: URL_A, status: "completed", raw: rawAxe([imageAlt]) }] });
    const measurements = result.run.measurements!;
    expect(measurements.engine).toEqual({ name: "axe-core", version: "4.14.0" });
    expect(measurements.renderMode).toBe("javascript-disabled");
    expect(measurements.pages[0]).toMatchObject({ status: "completed", incompleteRuleIds: ["color-contrast"], passedRuleCount: 30, inapplicableRuleCount: 40 });
    expect(measurements.pages[0]!.violations[0]!.nodes).toHaveLength(10);
    expect(result.findings.map((finding) => finding.source.ruleId)).toEqual(["image-alt"]);
  });

  it("never claims WCAG compliance, even with zero violations", () => {
    const result = analyzeAccessibility({ enabled: true, pages: [{ url: URL_A, status: "completed", raw: rawAxe() }] });
    expect(result.findings).toEqual([]);
    expect(result.run.status).toBe("completed");
    expect(result.run.notes).toEqual(ACCESSIBILITY_NOTES);
    expect(result.run.notes.join(" ")).toMatch(/do not establish WCAG conformance/);
    expect(JSON.stringify(result)).not.toMatch(/\bcompliant\b|passes WCAG/i);
  });

  it("maps unknown impact to low severity and truncates oversized evidence", () => {
    const result = analyzeAccessibility({ enabled: true, pages: [{ url: URL_A, status: "completed", raw: rawAxe([{ ...regionRule, impact: null, nodes: [{ target: ["div"], html: `<div>${"x".repeat(5000)}</div>` }] }]) }] });
    expect(result.findings[0]?.severity).toBe("low");
    const node = result.run.measurements!.pages[0]!.violations[0]!.nodes[0]!;
    expect(node.html.length).toBeLessThanOrEqual(300);
  });

  it("is skipped when accessibility checks were not requested", () => {
    const result = analyzeAccessibility({ enabled: false, pages: [] });
    expect(result.run).toMatchObject({ status: "skipped", measurements: null, findingCount: 0 });
  });

  it("fails when no page could be analyzed", () => {
    const result = analyzeAccessibility({ enabled: true, pages: [] });
    expect(result.run.status).toBe("failed");
    expect(result.run.issues[0]?.code).toBe("NO_PAGES_ANALYZED");
  });

  it("is partial when axe failed on some pages and keeps findings from the others", () => {
    const result = analyzeAccessibility({ enabled: true, pages: [
      { url: URL_A, status: "completed", raw: rawAxe([imageAlt]) },
      { url: URL_B, status: "failed", error: { code: "AXE_TIMEOUT", message: "axe-core did not finish." } },
    ] });
    expect(result.run.status).toBe("partial");
    expect(result.findings).toHaveLength(1);
    expect(result.run.issues).toEqual([{ code: "AXE_TIMEOUT", message: "axe-core did not finish.", url: URL_B }]);
    expect(result.run.measurements!.pages[1]).toMatchObject({ url: URL_B, status: "failed", violations: [] });
  });

  it("treats unrecognizable axe output as a failed page rather than zero violations", () => {
    const result = analyzeAccessibility({ enabled: true, pages: [{ url: URL_A, status: "completed", raw: { nope: true } }] });
    expect(result.run.status).toBe("failed");
    expect(result.findings).toEqual([]);
    expect(result.run.issues[0]).toMatchObject({ code: "AXE_INVALID_RESULT", url: URL_A });
  });
});

describe("wcagTags", () => {
  it("keeps WCAG level and success-criterion tags only", () => {
    expect(wcagTags(["wcag2a", "wcag21aa", "wcag143", "wcag2aaa", "best-practice", "cat.color", "TTv5", "EN-9.1.4.3"])).toEqual(["wcag2a", "wcag21aa", "wcag143", "wcag2aaa"]);
  });
});
