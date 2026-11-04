import type { AuditAnalysis, AuditFinding } from "@scopepilot/contracts/analysis";
import type { AuditStatusResponse } from "@scopepilot/contracts/audit";
import type { AuditInterpretation } from "@scopepilot/contracts/interpretation";

export const AUDIT_ID = "65f0a1b2c3d4e5f6a7b8c9d0";
const ROOT = "https://shop.example.com/";

export const titleFinding: AuditFinding = {
  id: "seo:title-missing:https://shop.example.com/",
  category: "seo",
  severity: "high",
  basis: "rule-based",
  title: "Page has no title element",
  source: { tool: "scopepilot-seo-rules", ruleId: "title-missing" },
  affectedUrl: ROOT,
  evidence: { kind: "page-signal", signal: "title", observed: null, expected: "A non-empty <title> element" },
  explanation: "Search engines use the title as the primary link text in results.",
  remediation: "Add a unique, descriptive <title> element.",
  references: ["https://developers.google.com/search/docs/appearance/title-link"],
};

export const lcpFinding: AuditFinding = {
  id: "performance:lab:largest-contentful-paint:mobile",
  category: "performance",
  severity: "medium",
  basis: "measured",
  title: "Largest Contentful Paint is slow on mobile (lab)",
  source: { tool: "pagespeed-insights", ruleId: "largest-contentful-paint", version: "12.2.0" },
  affectedUrl: ROOT,
  evidence: { kind: "metric", metric: "largest-contentful-paint", dataSource: "lab", strategy: "mobile", value: 4210, unit: "millisecond", displayValue: "4.2 s", lighthouseScore: 0.31 },
  explanation: "LCP measures when the main content becomes visible.",
  remediation: "Optimise the LCP image and reduce render-blocking resources.",
  references: [],
};

export const axeFinding: AuditFinding = {
  id: "accessibility:image-alt:https://shop.example.com/",
  category: "accessibility",
  severity: "critical",
  basis: "measured",
  title: "Images must have alternative text",
  source: { tool: "axe-core", ruleId: "image-alt", version: "4.10.2" },
  affectedUrl: ROOT,
  evidence: {
    kind: "axe-violation",
    ruleId: "image-alt",
    impact: "critical",
    wcagTags: ["wcag2a", "wcag111"],
    nodes: [{ target: "img.hero", html: "<img class=\"hero\" src=\"/hero.jpg\">", failureSummary: "Element does not have an alt attribute" }],
    totalNodes: 3,
  },
  explanation: "Screen reader users cannot perceive images without text alternatives.",
  remediation: "Add an alt attribute describing each informative image.",
  references: ["https://dequeuniversity.com/rules/axe/4.10/image-alt"],
};

export function analysis(overrides: Partial<AuditAnalysis["modules"]> = {}, findings: AuditFinding[] = [titleFinding, lcpFinding, axeFinding]): AuditAnalysis {
  return {
    modules: {
      seo: {
        status: "completed",
        findingCount: findings.filter((finding) => finding.category === "seo").length,
        issues: [],
        notes: ["SEO checks use the crawled HTML only."],
        measurements: {
          pages: [{ url: ROOT, httpStatus: 200, finalUrl: ROOT, titleLength: null, metaDescriptionLength: 142, h1Count: 1, headingCount: 6, canonical: ROOT, robots: null, xRobotsTag: null, imageCount: 8, imagesMissingAlt: 3, internalLinkCount: 21, externalLinkCount: 4 }],
          coverage: { pagesAnalyzed: 1, pagesNotLoaded: [], internalLinksDiscovered: 21, internalLinksRequested: 21 },
        },
      },
      performance: {
        status: "partial",
        findingCount: findings.filter((finding) => finding.category === "performance").length,
        issues: [{ code: "PAGESPEED_REQUEST_FAILED", message: "PageSpeed Insights returned HTTP 500.", strategy: "desktop" }],
        notes: [],
        measurements: {
          requestedUrl: ROOT,
          runs: [
            {
              strategy: "mobile", status: "completed", fetchedAt: "2026-11-03T10:15:00.000Z", finalUrl: ROOT, lighthouseVersion: "12.2.0", performanceScore: 0.42,
              lab: { "largest-contentful-paint": { value: 4210, unit: "millisecond", displayValue: "4.2 s", score: 0.31 }, "cumulative-layout-shift": { value: 0.02, unit: "unitless", displayValue: "0.02", score: 1 } },
              unavailableLabMetrics: ["total-blocking-time"],
              field: null,
              fieldUnavailableReason: "The Chrome UX Report has insufficient real-user data for this URL or origin.",
              runWarnings: [],
              error: null,
            },
            {
              strategy: "desktop", status: "failed", fetchedAt: null, finalUrl: null, lighthouseVersion: null, performanceScore: null, lab: {}, unavailableLabMetrics: [], field: null, fieldUnavailableReason: null, runWarnings: [],
              error: { code: "PAGESPEED_REQUEST_FAILED", message: "PageSpeed Insights returned HTTP 500." },
            },
          ],
        },
      },
      accessibility: {
        status: "completed",
        findingCount: findings.filter((finding) => finding.category === "accessibility").length,
        issues: [],
        notes: [],
        measurements: {
          engine: { name: "axe-core", version: "4.10.2" },
          ruleTags: ["wcag2a", "wcag2aa"],
          renderMode: "javascript-disabled",
          pages: [{ url: ROOT, status: "completed", error: null, violations: [], incompleteRuleIds: ["color-contrast"], passedRuleCount: 31, inapplicableRuleCount: 40 }],
        },
      },
      ...overrides,
    },
    findings,
  };
}

export function audit(overrides: Partial<AuditStatusResponse> = {}): AuditStatusResponse {
  return {
    id: AUDIT_ID,
    status: "partial",
    createdAt: "2026-11-03T10:00:00.000Z",
    startedAt: "2026-11-03T10:00:05.000Z",
    completedAt: "2026-11-03T10:16:00.000Z",
    result: {
      pages: [{ url: ROOT, title: null, metaDescription: "Shop", headings: [], canonical: ROOT, robots: null, links: [], images: [], httpStatus: 200, finalUrl: ROOT, warnings: [] }],
      warnings: [],
      analysis: analysis(),
    },
    ...overrides,
  };
}

export function interpretation(overrides: Partial<AuditInterpretation> = {}): AuditInterpretation {
  return {
    auditId: AUDIT_ID,
    status: "completed",
    provider: "gemini",
    model: "gemini-3.8-flash",
    promptVersion: "p5-2026-11.1",
    startedAt: "2026-11-03T11:00:00.000Z",
    completedAt: "2026-11-03T11:00:20.000Z",
    input: { findingCount: 3, issueGroupCount: 3, issueGroupsOmitted: 0 },
    content: {
      overview: "The homepage has a missing title, slow mobile loading and images without text alternatives.",
      issues: [{
        ref: "I1", category: "accessibility", ruleId: "image-alt", title: "Images must have alternative text", severity: "critical", findingIds: [axeFinding.id],
        plainLanguage: "Some images have no description for screen readers.",
        whyItMatters: "People using screen readers miss the information these images carry.",
        businessRelevance: "This may make it harder for some visitors to understand products.",
        recommendedImprovements: ["Add descriptive alt text to informative images."],
      }],
      opportunities: [{ title: "Accessibility remediation", summary: "Fix missing text alternatives.", refs: ["I1"], deliverables: ["Alt text pass"], findingIds: [axeFinding.id] }],
      evidenceGaps: ["Desktop performance was not measured."],
    },
    rejected: [],
    uninterpretedRefs: [],
    ...overrides,
  };
}
