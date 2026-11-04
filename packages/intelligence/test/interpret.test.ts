import type { AuditAnalysis, AuditFinding, PerformanceRun } from "@scopepilot/contracts/analysis";
import { describe, expect, it } from "vitest";
import { AiProviderError, type AiProvider } from "../src/gemini.js";
import { interpretAudit } from "../src/interpret.js";
import { auditCoverage, buildIssueGroups } from "../src/issues.js";
import { analysisWith, altFinding, altFindingAbout, contrastFinding, fullAnalysis, lcpFinding, ROOT } from "./fixtures.js";

function providerReturning(output: unknown): AiProvider & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  return {
    name: "gemini",
    model: "test-model",
    calls,
    async generate(request) {
      calls.push({ system: request.system, user: request.user });
      return typeof output === "string" ? output : JSON.stringify(output);
    },
  };
}

function providerThrowing(error: unknown): AiProvider {
  return { name: "gemini", model: "test-model", generate: async () => { throw error; } };
}

const issue = (ref: string, overrides: Record<string, unknown> = {}) => ({
  ref,
  plainLanguage: "Some text on the page is hard to read.",
  whyItMatters: "Visitors with low vision may struggle to read it.",
  businessRelevance: "If visitors cannot read the call to action, fewer of them may contact the business.",
  recommendedImprovements: ["Darken the button text colour."],
  ...overrides,
});

const validOutput = {
  overview: "The audit found contrast, loading speed and image alt text issues. Field data was unavailable.",
  issues: [
    issue("I1"),
    issue("I2", { plainLanguage: "The main content took 4.2 s to appear in the mobile lab test.", whyItMatters: "Slow loading can frustrate visitors." }),
    issue("I3", { plainLanguage: "3 images have no alt text.", whyItMatters: "Search engines and screen readers rely on alt text." }),
  ],
  opportunities: [{ title: "Accessibility remediation", summary: "Fix contrast and alt text.", refs: ["I1", "I3"], deliverables: ["Update colour tokens", "Write alt text"] }],
  evidenceGaps: ["Chrome UX Report field data was not available for this URL."],
};

describe("buildIssueGroups", () => {
  it("groups findings by rule and orders by severity", () => {
    const { groups, omitted } = buildIssueGroups(fullAnalysis.findings, 25);
    expect(omitted).toBe(0);
    expect(groups.map((group) => [group.ref, group.ruleId, group.severity])).toEqual([
      ["I1", "color-contrast", "high"],
      ["I2", "largest-contentful-paint", "high"],
      ["I3", "image-alt", "medium"],
    ]);
    expect(groups[2]!.findingIds).toEqual([altFinding.id, altFindingAbout.id]);
    expect(groups[2]!.affectedUrls).toEqual(["https://example.test/", "https://example.test/about"]);
  });

  it("caps the number of groups and reports omissions", () => {
    const { groups, omitted } = buildIssueGroups(fullAnalysis.findings, 2);
    expect(groups).toHaveLength(2);
    expect(omitted).toBe(1);
  });
});

describe("interpretAudit", () => {
  it("returns a completed interpretation mapped to finding IDs", async () => {
    const provider = providerReturning(validOutput);
    const outcome = await interpretAudit({ analysis: fullAnalysis, rootUrl: ROOT, provider });
    expect(outcome.status).toBe("completed");
    expect(outcome.rejected).toEqual([]);
    expect(outcome.input).toEqual({ findingCount: 4, issueGroupCount: 3, issueGroupsOmitted: 0 });
    expect(outcome.content?.issues.map((item) => [item.ref, item.findingIds])).toEqual([
      ["I1", [contrastFinding.id]],
      ["I2", [lcpFinding.id]],
      ["I3", [altFinding.id, altFindingAbout.id]],
    ]);
    expect(outcome.content?.opportunities[0]!.findingIds).toEqual([contrastFinding.id, altFinding.id, altFindingAbout.id]);
    expect(provider.calls[0]!.user).toContain("untrusted");
    expect(provider.calls[0]!.user).toContain("\"ref\":\"I2\"");
  });

  it("does not mutate the supplied analysis", async () => {
    const analysis = structuredClone(fullAnalysis);
    await interpretAudit({ analysis, rootUrl: ROOT, provider: providerReturning(validOutput) });
    expect(analysis).toEqual(fullAnalysis);
  });

  it("rejects fabricated findings, measurements and URLs while keeping grounded items", async () => {
    const outcome = await interpretAudit({
      analysis: fullAnalysis,
      rootUrl: ROOT,
      provider: providerReturning({
        ...validOutput,
        issues: [
          validOutput.issues[0],
          issue("I2", { plainLanguage: "The page took 9.8 s to load." }),
          issue("I3", { recommendedImprovements: ["See https://evil.test/fix for details."] }),
          issue("I9", { plainLanguage: "The checkout form has no labels." }),
        ],
      }),
    });
    expect(outcome.status).toBe("partial");
    expect(outcome.content?.issues.map((item) => item.ref)).toEqual(["I1"]);
    expect(outcome.uninterpretedRefs).toEqual(["I2", "I3"]);
    expect(outcome.rejected.map((item) => item.path)).toEqual(["issues[1]", "issues[2]", "issues[3]"]);
    expect(outcome.rejected[0]!.reason).toMatch(/9\.8 s/);
    expect(outcome.rejected[1]!.reason).toMatch(/URL/);
    expect(outcome.rejected[2]!.reason).toMatch(/unknown issue "I9"/);
  });

  it("rejects guarantees, monetary claims, compliance claims and unhedged business relevance", async () => {
    const outcome = await interpretAudit({
      analysis: fullAnalysis,
      rootUrl: ROOT,
      provider: providerReturning({
        ...validOutput,
        overview: "Fixing these issues will increase revenue.",
        issues: [
          issue("I1", { businessRelevance: "Fixing this makes the site WCAG compliant." }),
          issue("I2", { businessRelevance: "Faster pages bring in $5,000 per month." }),
          issue("I3", { businessRelevance: "Alt text improves rankings." }),
          issue("I1", { whyItMatters: "Automated checks cannot guarantee the site is WCAG compliant." }),
        ],
        opportunities: [{ title: "Speed work", summary: "We guarantee first page of Google.", refs: ["I2"], deliverables: ["Image optimisation"] }],
      }),
    });
    expect(outcome.content?.overview).toBeNull();
    expect(outcome.content?.issues.map((item) => item.ref)).toEqual(["I1"]);
    expect(outcome.content?.opportunities).toEqual([]);
    const reasons = outcome.rejected.map((item) => `${item.path}: ${item.reason}`);
    expect(reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/^overview: .*guaranteed-outcome/),
      expect.stringMatching(/^issues\[0\]: .*compliance/),
      expect.stringMatching(/^issues\[1\]: .*monetary/),
      expect.stringMatching(/^issues\[2\]: .*conditionally/),
      expect.stringMatching(/^opportunities\[0\]: .*guaranteed-outcome/),
    ]));
  });

  it("drops opportunities without supplied refs and strips unknown refs", async () => {
    const outcome = await interpretAudit({
      analysis: fullAnalysis,
      rootUrl: ROOT,
      provider: providerReturning({
        ...validOutput,
        opportunities: [
          { title: "Ghost work", summary: "Fix the broken checkout.", refs: ["I42"], deliverables: ["Checkout rebuild"] },
          { title: "Speed", summary: "Improve loading.", refs: ["I2", "I77"], deliverables: ["Image optimisation"] },
        ],
      }),
    });
    expect(outcome.status).toBe("partial");
    expect(outcome.content?.opportunities.map((item) => [item.title, item.refs])).toEqual([["Speed", ["I2"]]]);
  });

  it("accepts unit conversions of measured values", async () => {
    const outcome = await interpretAudit({
      analysis: analysisWith([lcpFinding]),
      rootUrl: ROOT,
      provider: providerReturning({ overview: "One loading issue was measured.", issues: [issue("I1", { plainLanguage: "LCP was 4,200 ms (about 4 s); Lighthouse scored it 31%." })], opportunities: [], evidenceGaps: [] }),
    });
    expect(outcome.status).toBe("completed");
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a non-object", "[1,2]"],
    ["missing arrays", JSON.stringify({ overview: "x" })],
  ])("fails on %s", async (_label, raw) => {
    const outcome = await interpretAudit({ analysis: fullAnalysis, rootUrl: ROOT, provider: providerReturning(raw) });
    expect(outcome.status).toBe("failed");
    expect(outcome.failure?.code).toBe("AI_INVALID_OUTPUT");
    expect(outcome.content).toBeNull();
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const outcome = await interpretAudit({ analysis: fullAnalysis, rootUrl: ROOT, provider: providerReturning(`\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``) });
    expect(outcome.status).toBe("completed");
  });

  it("fails when no issue interpretation survives validation", async () => {
    const outcome = await interpretAudit({ analysis: fullAnalysis, rootUrl: ROOT, provider: providerReturning({ ...validOutput, issues: [issue("I99"), { ref: "I1" }] }) });
    expect(outcome.status).toBe("failed");
    expect(outcome.failure?.code).toBe("AI_INVALID_OUTPUT");
    expect(outcome.rejected).toHaveLength(2);
    expect(outcome.uninterpretedRefs).toEqual(["I1", "I2", "I3"]);
  });

  it("reports provider failures without throwing", async () => {
    const limited = await interpretAudit({ analysis: fullAnalysis, rootUrl: ROOT, provider: providerThrowing(new AiProviderError("AI_RATE_LIMITED", "Rate limited.", 30)) });
    expect(limited).toMatchObject({ status: "failed", content: null, failure: { code: "AI_RATE_LIMITED", retryAfterSeconds: 30 } });
    const timeout = await interpretAudit({ analysis: fullAnalysis, rootUrl: ROOT, provider: providerThrowing(new AiProviderError("AI_TIMEOUT", "Timed out.")) });
    expect(timeout.failure?.code).toBe("AI_TIMEOUT");
    const unexpected = await interpretAudit({ analysis: fullAnalysis, rootUrl: ROOT, provider: providerThrowing(new Error("boom")) });
    expect(unexpected.failure?.code).toBe("AI_PROVIDER_ERROR");
  });

  it("does not call the provider when there are no findings", async () => {
    const provider = providerReturning(validOutput);
    const outcome = await interpretAudit({ analysis: analysisWith([]), rootUrl: ROOT, provider });
    expect(outcome.failure?.code).toBe("NO_FINDINGS");
    expect(provider.calls).toHaveLength(0);
  });
});

describe("audit coverage and evidence gaps", () => {
  const PAGE = "https://example.test/";
  const desktopUnusedJs: AuditFinding = { ...lcpFinding, id: "performance:unused-js:desktop", severity: "low", title: "Reduce unused JavaScript", source: { tool: "pagespeed-insights", ruleId: "lighthouse.unused-javascript" }, evidence: { kind: "lighthouse-audit", auditId: "unused-javascript", strategy: "desktop", lighthouseScore: 0.5, estimatedSavingsBytes: 54693 } };
  const mobileUnusedJs: AuditFinding = { ...desktopUnusedJs, id: "performance:unused-js:mobile", evidence: { ...desktopUnusedJs.evidence, strategy: "mobile" } as AuditFinding["evidence"] };
  const perfRun = (strategy: "mobile" | "desktop"): PerformanceRun => ({ strategy, status: "completed", fetchedAt: null, finalUrl: PAGE, lighthouseVersion: "12.0.0", performanceScore: 0.98, lab: {}, unavailableLabMetrics: [], field: null, fieldUnavailableReason: "Chrome UX Report has no data for this URL or origin.", runWarnings: [], error: null });
  const base = analysisWith([contrastFinding, mobileUnusedJs, desktopUnusedJs]);
  const onePage: AuditAnalysis = {
    ...base,
    modules: {
      seo: { ...base.modules.seo, measurements: { pages: [{ url: PAGE, httpStatus: 200, finalUrl: PAGE, titleLength: 10, metaDescriptionLength: 50, h1Count: 1, headingCount: 2, canonical: PAGE, robots: null, xRobotsTag: null, imageCount: 4, imagesMissingAlt: 4, internalLinkCount: 1, internalLinkTargetCount: 0, externalLinkCount: 0 }], coverage: { pagesAnalyzed: 1, pagesNotLoaded: [], internalLinksDiscovered: 0, internalLinksRequested: 0 } } },
      performance: { ...base.modules.performance, status: "completed", issues: [], measurements: { requestedUrl: PAGE, runs: [perfRun("mobile"), perfRun("desktop")] } },
      accessibility: { ...base.modules.accessibility, measurements: { engine: { name: "axe-core", version: "4.10.0" }, ruleTags: ["wcag2a"], renderMode: "javascript-disabled", pages: [{ url: PAGE, status: "completed", error: null, violations: [], incompleteRuleIds: [], passedRuleCount: 20, inapplicableRuleCount: 10 }] } },
    },
  };

  it("derives inspected, not-inspected, unavailable and limitation items from stored results", () => {
    const coverage = auditCoverage(onePage);
    expect(coverage.inspected).toEqual([`1 page inspected: ${PAGE}.`, "Lighthouse lab measurement (mobile).", "Lighthouse lab measurement (desktop)."]);
    expect(coverage.notInspected).toEqual(["Other pages of the website were not inspected; only one page was analysed."]);
    expect(coverage.unavailable.join(" ")).toMatch(/real-user \(field\) data was not available for mobile.*desktop/);
    expect(coverage.limitations.join(" ")).toContain("JavaScript disabled");
  });

  it("sends coverage and grouped strategies to the AI", async () => {
    const provider = providerReturning(validOutput);
    await interpretAudit({ analysis: onePage, rootUrl: ROOT, provider });
    const data = JSON.parse(provider.calls[0]!.user.split("```json\n")[1]!.split("\n```")[0]!) as { coverage: { notInspected: string[] }; issues: Array<{ ruleId: string; strategies?: string[] }> };
    expect(data.coverage.notInspected[0]).toContain("only one page");
    expect(data.issues.find((item) => item.ruleId === "lighthouse.unused-javascript")?.strategies?.slice().sort()).toEqual(["desktop", "mobile"]);
    expect(provider.calls[0]!.system).toContain("Never claim there were no evidence gaps");
  });

  it("rejects reassuring gap claims that contradict the coverage, and keeps honest ones", async () => {
    const reassuring = await interpretAudit({ analysis: onePage, rootUrl: ROOT, provider: providerReturning({ ...validOutput, overview: "Contrast and unused JavaScript issues were found. No major evidence gaps were encountered during the automated checks.", evidenceGaps: ["This was a comprehensive audit of the site."] }) });
    expect(reassuring.status).toBe("partial");
    expect(reassuring.content?.overview).toBeNull();
    expect(reassuring.content?.evidenceGaps).toEqual([]);
    expect(reassuring.rejected.map((item) => item.path)).toEqual(expect.arrayContaining(["overview", "evidenceGaps[0]"]));

    const honest = await interpretAudit({ analysis: onePage, rootUrl: ROOT, provider: providerReturning({ ...validOutput, overview: "The inspected page produced sufficient evidence for the findings below. This audit does not cover JavaScript-rendered content, the entire website, or real-user performance data.", evidenceGaps: ["Only one page was inspected.", "Real-user (field) data was unavailable."] }) });
    expect(honest.rejected.filter((item) => item.path === "overview" || item.path.startsWith("evidenceGaps"))).toEqual([]);
    expect(honest.content?.evidenceGaps).toHaveLength(2);
  });
});
