import type { AccessibilityMeasurements, AccessibilityPageRun, AuditFinding, AxeImpact, AxeNodeEvidence, AxeViolationRecord, FindingSeverity, ModuleIssue } from "@scopepilot/contracts/analysis";
import { findingId, moduleResult, type ModuleResult, truncate } from "./findings.js";

/** axe-core rule tags run by ScopePilot. This is a selected subset, not a complete WCAG evaluation. */
export const AXE_RULE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] as const;
export const MAX_NODES_PER_VIOLATION = 10;
const MAX_NODES_PER_FINDING = 5;
const MAX_HTML_LENGTH = 300;
const IMPACTS = new Set<AxeImpact>(["minor", "moderate", "serious", "critical"]);
const SEVERITY_BY_IMPACT: Record<AxeImpact, FindingSeverity> = { critical: "critical", serious: "high", moderate: "medium", minor: "low" };

export const ACCESSIBILITY_NOTES = [
  "Automated axe-core checks detect only a subset of accessibility barriers. These results do not establish WCAG conformance; manual and assistive-technology testing is still required.",
  "Pages were analyzed with JavaScript disabled (crawler security boundary) at a 1440×900 viewport; content rendered client-side and iframe content were not evaluated.",
  "Rules axe-core could not decide automatically are recorded as needing manual review and are not reported as findings.",
];

/** Raw output produced by the worker's in-browser axe run (see apps/worker/src/accessibility.ts). */
export interface RawAxeOutput {
  engineVersion: string | null;
  violations: unknown[];
  incompleteRuleIds: unknown[];
  passedRuleCount: number;
  inapplicableRuleCount: number;
}

export type AccessibilityPageInput =
  | { url: string; status: "completed"; raw: unknown }
  | { url: string; status: "failed" | "skipped"; error: ModuleIssue };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

function normalizeTarget(target: unknown): string {
  if (!Array.isArray(target)) return "";
  return target.map((part) => (Array.isArray(part) ? part.map(String).join(" >>> ") : String(part))).join(" ");
}

function normalizeNode(node: unknown): AxeNodeEvidence | null {
  if (!isObject(node)) return null;
  return { target: truncate(normalizeTarget(node.target), 300), html: truncate(text(node.html), MAX_HTML_LENGTH), failureSummary: text(node.failureSummary) ? truncate(text(node.failureSummary), 500) : null };
}

function normalizeViolation(value: unknown): AxeViolationRecord | null {
  if (!isObject(value) || !text(value.id)) return null;
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const impact = IMPACTS.has(value.impact as AxeImpact) ? (value.impact as AxeImpact) : null;
  return {
    id: text(value.id),
    impact,
    description: truncate(text(value.description), 500),
    help: truncate(text(value.help), 200),
    helpUrl: text(value.helpUrl),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
    nodes: nodes.slice(0, MAX_NODES_PER_VIOLATION).map(normalizeNode).filter((node): node is AxeNodeEvidence => node !== null),
    nodeCount: Math.max(count(value.nodeCount), nodes.length),
  };
}

/** Converts raw axe output into bounded, typed measurements. Returns null when the output is not recognizable. */
export function normalizeAxeOutput(url: string, raw: unknown): { run: AccessibilityPageRun; engineVersion: string | null } | null {
  if (!isObject(raw) || !Array.isArray(raw.violations)) return null;
  return {
    engineVersion: text(raw.engineVersion) || null,
    run: {
      url,
      status: "completed",
      error: null,
      violations: raw.violations.map(normalizeViolation).filter((violation): violation is AxeViolationRecord => violation !== null),
      incompleteRuleIds: Array.isArray(raw.incompleteRuleIds) ? raw.incompleteRuleIds.filter((id): id is string => typeof id === "string") : [],
      passedRuleCount: count(raw.passedRuleCount),
      inapplicableRuleCount: count(raw.inapplicableRuleCount),
    },
  };
}

export function wcagTags(tags: string[]): string[] {
  return tags.filter((tag) => /^wcag\d+a{1,3}$/.test(tag) || /^wcag\d{3,}$/.test(tag));
}

function violationFinding(url: string, violation: AxeViolationRecord, engineVersion: string | null): AuditFinding {
  const tags = wcagTags(violation.tags);
  const guidance = violation.nodes.find((node) => node.failureSummary)?.failureSummary;
  return {
    id: findingId(`axe.${violation.id}`, url),
    category: "accessibility",
    severity: violation.impact ? SEVERITY_BY_IMPACT[violation.impact] : "low",
    basis: "rule-based",
    title: violation.help || violation.id,
    source: { tool: "axe-core", ruleId: violation.id, version: engineVersion ?? undefined },
    affectedUrl: url,
    evidence: { kind: "axe-violation", ruleId: violation.id, impact: violation.impact, wcagTags: tags, nodes: violation.nodes.slice(0, MAX_NODES_PER_FINDING), totalNodes: violation.nodeCount },
    explanation: `${violation.description} axe-core reported ${violation.nodeCount} affected element${violation.nodeCount === 1 ? "" : "s"} on this page${violation.impact ? ` with "${violation.impact}" impact` : ""}.${tags.length ? ` Related WCAG tags: ${tags.join(", ")}.` : " This is a best-practice rule, not a WCAG success criterion."}`,
    remediation: `Fix each affected element.${guidance ? ` axe-core guidance: ${guidance}` : ""} See the rule documentation for techniques.`,
    references: violation.helpUrl ? [violation.helpUrl] : [],
  };
}

export interface AccessibilityInput {
  enabled: boolean;
  pages: AccessibilityPageInput[];
}

export function analyzeAccessibility(input: AccessibilityInput): ModuleResult<AccessibilityMeasurements> {
  if (!input.enabled) return moduleResult<AccessibilityMeasurements>({ status: "skipped", measurements: null, issues: [], notes: ["Accessibility checks were not requested for this audit."] });
  if (!input.pages.length) return moduleResult<AccessibilityMeasurements>({ status: "failed", measurements: null, issues: [{ code: "NO_PAGES_ANALYZED", message: "No inspected page loaded successfully, so accessibility checks could not run." }], notes: ACCESSIBILITY_NOTES });

  let engineVersion: string | null = null;
  const runs: AccessibilityPageRun[] = [];
  const issues: ModuleIssue[] = [];
  const findings: AuditFinding[] = [];
  for (const page of input.pages) {
    if (page.status !== "completed") {
      runs.push({ url: page.url, status: page.status, error: page.error, violations: [], incompleteRuleIds: [], passedRuleCount: 0, inapplicableRuleCount: 0 });
      issues.push({ ...page.error, url: page.url });
      continue;
    }
    const normalized = normalizeAxeOutput(page.url, page.raw);
    if (!normalized) {
      const error = { code: "AXE_INVALID_RESULT", message: "axe-core returned a result that could not be interpreted." };
      runs.push({ url: page.url, status: "failed", error, violations: [], incompleteRuleIds: [], passedRuleCount: 0, inapplicableRuleCount: 0 });
      issues.push({ ...error, url: page.url });
      continue;
    }
    engineVersion ??= normalized.engineVersion;
    runs.push(normalized.run);
    findings.push(...normalized.run.violations.map((violation) => violationFinding(page.url, violation, normalized.engineVersion)));
  }
  const completed = runs.filter((run) => run.status === "completed").length;
  return moduleResult({
    status: completed === 0 ? "failed" : completed === runs.length ? "completed" : "partial",
    measurements: { engine: { name: "axe-core", version: engineVersion }, ruleTags: [...AXE_RULE_TAGS], renderMode: "javascript-disabled", pages: runs },
    issues,
    notes: ACCESSIBILITY_NOTES,
  }, findings);
}
