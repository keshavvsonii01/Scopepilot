import type { AuditAnalysis, AuditFinding, FindingCategory, FindingEvidence, FindingSeverity } from "@scopepilot/contracts/analysis";

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const MAX_FINDINGS_PER_GROUP = 4;
const MAX_URLS_PER_GROUP = 10;
const MAX_SNIPPET = 180;

/** Findings that share a category and detection rule, presented to the AI as one issue `ref`. */
export interface IssueGroup {
  ref: string;
  category: FindingCategory;
  tool: AuditFinding["source"]["tool"];
  ruleId: string;
  title: string;
  severity: FindingSeverity;
  basis: AuditFinding["basis"];
  findingIds: string[];
  findingCount: number;
  affectedUrls: string[];
  affectedUrlCount: number;
  explanation: string;
  remediation: string;
  references: string[];
  evidence: Array<{ affectedUrl: string; evidence: unknown }>;
  /** PageSpeed strategies whose separate measurements are grouped here (empty when not applicable). */
  strategies: Array<"mobile" | "desktop">;
}

function clip(value: string, max = MAX_SNIPPET): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Compact copy of evidence for the prompt. Values are copied, never recomputed. */
export function compactEvidence(evidence: FindingEvidence): unknown {
  switch (evidence.kind) {
    case "page-signal":
      return {
        kind: evidence.kind,
        signal: evidence.signal,
        observed: typeof evidence.observed === "string" ? clip(evidence.observed) : evidence.observed,
        expected: evidence.expected,
        ...(evidence.samples ? { samples: evidence.samples.slice(0, 3).map((sample) => clip(sample)) } : {}),
        ...(evidence.sampleTotal !== undefined ? { sampleTotal: evidence.sampleTotal } : {}),
        ...(evidence.relatedUrls ? { relatedUrls: evidence.relatedUrls.slice(0, 5) } : {}),
      };
    case "axe-violation":
      return {
        kind: evidence.kind,
        ruleId: evidence.ruleId,
        impact: evidence.impact,
        wcagTags: evidence.wcagTags,
        totalNodes: evidence.totalNodes,
        nodes: evidence.nodes.slice(0, 2).map((node) => ({ target: clip(node.target, 120), html: clip(node.html), failureSummary: node.failureSummary ? clip(node.failureSummary, 240) : null })),
      };
    case "metric":
    case "lighthouse-audit":
      return evidence;
  }
}

export function buildIssueGroups(findings: AuditFinding[], maxGroups: number): { groups: IssueGroup[]; omitted: number } {
  const byKey = new Map<string, AuditFinding[]>();
  for (const finding of findings) {
    const key = `${finding.category}\u0000${finding.source.tool}\u0000${finding.source.ruleId}`;
    const list = byKey.get(key);
    if (list) list.push(finding);
    else byKey.set(key, [finding]);
  }
  const ordered = [...byKey.values()].map((members) => {
    const sorted = [...members].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.affectedUrl.localeCompare(b.affectedUrl));
    return { members: sorted, severity: sorted[0]!.severity };
  }).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.members.length - a.members.length || a.members[0]!.id.localeCompare(b.members[0]!.id));

  const groups = ordered.slice(0, maxGroups).map(({ members, severity }, index): IssueGroup => {
    const first = members[0]!;
    const urls = [...new Set(members.map((finding) => finding.affectedUrl))];
    return {
      ref: `I${index + 1}`,
      category: first.category,
      tool: first.source.tool,
      ruleId: first.source.ruleId,
      title: first.title,
      severity,
      basis: first.basis,
      findingIds: members.map((finding) => finding.id),
      findingCount: members.length,
      affectedUrls: urls.slice(0, MAX_URLS_PER_GROUP),
      affectedUrlCount: urls.length,
      explanation: first.explanation,
      remediation: first.remediation,
      references: [...new Set(members.flatMap((finding) => finding.references))].slice(0, 5),
      evidence: members.slice(0, MAX_FINDINGS_PER_GROUP).map((finding) => ({ affectedUrl: finding.affectedUrl, evidence: compactEvidence(finding.evidence) })),
      strategies: [...new Set(members.flatMap((finding) => finding.evidence.kind === "metric" || finding.evidence.kind === "lighthouse-audit" ? [finding.evidence.strategy] : []))],
    };
  });
  return { groups, omitted: Math.max(0, ordered.length - maxGroups) };
}

/** What the audit did and did not cover, derived only from stored module results. */
export interface AuditCoverage {
  inspected: string[];
  notInspected: string[];
  unavailable: string[];
  limitations: string[];
}

const RAN = new Set(["completed", "partial"]);

export function auditCoverage(analysis: AuditAnalysis): AuditCoverage {
  const coverage: AuditCoverage = { inspected: [], notInspected: [], unavailable: [], limitations: [] };
  const { seo, performance, accessibility } = analysis.modules;

  for (const [label, run] of [["SEO", seo], ["Performance", performance], ["Accessibility", accessibility]] as const) {
    if (!RAN.has(run.status)) coverage.unavailable.push(`${label} module did not produce results (status: ${run.status}).`);
  }

  const seoPages = seo.measurements?.pages.map((page) => page.url) ?? [];
  const a11yPages = accessibility.measurements?.pages.filter((page) => page.status === "completed").map((page) => page.url) ?? [];
  const pages = [...new Set([...seoPages, ...a11yPages])];
  if (pages.length > 0) {
    coverage.inspected.push(`${pages.length} page${pages.length === 1 ? "" : "s"} inspected: ${pages.slice(0, 5).join(", ")}${pages.length > 5 ? ", …" : ""}.`);
    if (pages.length === 1) coverage.notInspected.push("Other pages of the website were not inspected; only one page was analysed.");
  }
  const links = seo.measurements?.coverage;
  if (links && links.internalLinksDiscovered > links.internalLinksRequested) {
    coverage.notInspected.push(`${links.internalLinksDiscovered - links.internalLinksRequested} discovered internal link target(s) were not requested or checked.`);
  }
  if (links && links.pagesNotLoaded.length > 0) coverage.unavailable.push(`Pages that could not be loaded: ${links.pagesNotLoaded.slice(0, 5).join(", ")}.`);
  for (const page of accessibility.measurements?.pages ?? []) {
    if (page.status !== "completed") coverage.unavailable.push(`Accessibility checks did not complete for ${page.url} (${page.status}).`);
  }

  if (RAN.has(seo.status) || RAN.has(accessibility.status)) {
    coverage.limitations.push("SEO and accessibility checks evaluated HTML loaded with JavaScript disabled; content rendered by JavaScript was not evaluated.");
  }
  if (RAN.has(accessibility.status)) coverage.limitations.push("Automated accessibility checks cover only a subset of barriers and cannot establish WCAG conformance.");

  for (const run of performance.measurements?.runs ?? []) {
    if (run.status === "failed") coverage.unavailable.push(`Lighthouse ${run.strategy} measurement failed.`);
    else coverage.inspected.push(`Lighthouse lab measurement (${run.strategy}).`);
    if (!run.field) coverage.unavailable.push(`Chrome UX Report real-user (field) data was not available for ${run.strategy}${run.fieldUnavailableReason ? `: ${clip(run.fieldUnavailableReason, 160)}` : "."}`);
  }
  if (RAN.has(performance.status)) coverage.limitations.push("Lighthouse lab values come from a single simulated run and vary between runs.");
  return coverage;
}

/** Module statuses, issues and scope notes, so the AI can describe gaps instead of filling them. */
export function moduleContext(analysis: AuditAnalysis) {
  return Object.fromEntries(Object.entries(analysis.modules).map(([id, run]) => [id, {
    status: run.status,
    findingCount: run.findingCount,
    issues: run.issues.slice(0, 8).map((issue) => ({ code: issue.code, message: clip(issue.message, 240), ...(issue.strategy ? { strategy: issue.strategy } : {}) })),
    notes: run.notes.map((note) => clip(note, 300)),
  }]));
}
