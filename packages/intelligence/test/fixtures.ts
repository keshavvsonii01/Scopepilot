import type { AuditAnalysis, AuditFinding } from "@scopepilot/contracts/analysis";

export const ROOT = "https://example.test/";

export const altFinding: AuditFinding = {
  id: "seo:image-alt:https://example.test/",
  category: "seo",
  severity: "medium",
  basis: "rule-based",
  title: "Images missing alt attributes",
  source: { tool: "scopepilot-seo-rules", ruleId: "image-alt" },
  affectedUrl: "https://example.test/",
  evidence: { kind: "page-signal", signal: "imagesMissingAlt", observed: 3, expected: "0 images without an alt attribute", samples: ["https://example.test/hero.png"], sampleTotal: 3 },
  explanation: "3 of 5 images have no alt attribute.",
  remediation: "Add descriptive alt text.",
  references: ["https://developers.google.com/search/docs/appearance/google-images"],
};

export const altFindingAbout: AuditFinding = { ...altFinding, id: "seo:image-alt:https://example.test/about", affectedUrl: "https://example.test/about", severity: "low" };

export const lcpFinding: AuditFinding = {
  id: "performance:lcp:mobile",
  category: "performance",
  severity: "high",
  basis: "measured",
  title: "Slow Largest Contentful Paint (lab, mobile)",
  source: { tool: "pagespeed-insights", ruleId: "largest-contentful-paint" },
  affectedUrl: "https://example.test/",
  evidence: { kind: "metric", metric: "largest-contentful-paint", dataSource: "lab", strategy: "mobile", value: 4200, unit: "millisecond", displayValue: "4.2 s", lighthouseScore: 0.31 },
  explanation: "Lighthouse measured LCP at 4.2 s.",
  remediation: "Optimise the largest above-the-fold element.",
  references: ["https://web.dev/articles/lcp"],
};

export const contrastFinding: AuditFinding = {
  id: "accessibility:color-contrast:https://example.test/",
  category: "accessibility",
  severity: "high",
  basis: "measured",
  title: "Elements must meet minimum color contrast ratio thresholds",
  source: { tool: "axe-core", ruleId: "color-contrast", version: "4.10.0" },
  affectedUrl: "https://example.test/",
  evidence: { kind: "axe-violation", ruleId: "color-contrast", impact: "serious", wcagTags: ["wcag2aa", "wcag143"], totalNodes: 2, nodes: [{ target: ".cta", html: "<a class=\"cta\">Buy</a>", failureSummary: "Element has insufficient color contrast of 2.5 (expected 4.5:1)" }] },
  explanation: "axe-core reported 2 elements with insufficient contrast.",
  remediation: "Increase the contrast between text and background.",
  references: ["https://dequeuniversity.com/rules/axe/4.10/color-contrast"],
};

export function analysisWith(findings: AuditFinding[]): AuditAnalysis {
  const count = (category: string) => findings.filter((finding) => finding.category === category).length;
  return {
    modules: {
      seo: { status: "completed", measurements: null, issues: [], notes: ["Rule-based checks over crawled pages."], findingCount: count("seo") },
      performance: { status: "partial", measurements: null, issues: [{ code: "FIELD_DATA_UNAVAILABLE", message: "No Chrome UX Report data for this URL." }], notes: [], findingCount: count("performance") },
      accessibility: { status: "completed", measurements: null, issues: [], notes: ["Automated checks cover a subset of WCAG."], findingCount: count("accessibility") },
    },
    findings,
  };
}

export const fullAnalysis = analysisWith([altFinding, altFindingAbout, lcpFinding, contrastFinding]);
