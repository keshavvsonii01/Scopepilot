import type { AnalysisModuleId, AuditFinding, FieldMetricId, FindingCategory, FindingSeverity, LabMetricId, ModuleStatus } from "@scopepilot/contracts/analysis";
import type { AuditStatus } from "@scopepilot/contracts/audit";
import type { InterpretedIssue } from "@scopepilot/contracts/interpretation";

export type Tone = "neutral" | "lime" | "blue" | "amber" | "danger";

export const CATEGORY_ORDER: readonly FindingCategory[] = ["seo", "performance", "accessibility"];
export const SEVERITY_ORDER: readonly FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

export const MODULE_LABEL: Record<AnalysisModuleId, string> = { seo: "SEO", performance: "Performance", accessibility: "Accessibility" };

export const LAB_METRICS: ReadonlyArray<{ id: LabMetricId; label: string }> = [
  { id: "first-contentful-paint", label: "First Contentful Paint" },
  { id: "largest-contentful-paint", label: "Largest Contentful Paint" },
  { id: "total-blocking-time", label: "Total Blocking Time" },
  { id: "cumulative-layout-shift", label: "Cumulative Layout Shift" },
  { id: "speed-index", label: "Speed Index" },
];

export const FIELD_METRICS: ReadonlyArray<{ id: FieldMetricId; label: string }> = [
  { id: "LARGEST_CONTENTFUL_PAINT_MS", label: "Largest Contentful Paint" },
  { id: "INTERACTION_TO_NEXT_PAINT", label: "Interaction to Next Paint" },
  { id: "CUMULATIVE_LAYOUT_SHIFT_SCORE", label: "Cumulative Layout Shift" },
  { id: "FIRST_CONTENTFUL_PAINT_MS", label: "First Contentful Paint" },
  { id: "EXPERIMENTAL_TIME_TO_FIRST_BYTE", label: "Time to First Byte" },
];

export const NOT_REPORTED = "Not reported";

export function auditStatusTone(status: AuditStatus): Tone {
  return status === "completed" ? "lime" : status === "failed" ? "danger" : status === "partial" ? "amber" : "blue";
}

export function moduleStatusTone(status: ModuleStatus): Tone {
  return status === "completed" ? "lime" : status === "failed" ? "danger" : status === "partial" ? "amber" : "neutral";
}

export function severityTone(severity: FindingSeverity): Tone {
  return severity === "critical" || severity === "high" ? "danger" : severity === "medium" ? "amber" : severity === "low" ? "blue" : "neutral";
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export function formatDate(iso: string | undefined): string {
  if (!iso) return NOT_REPORTED;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? NOT_REPORTED : `${dateFormatter.format(date)} UTC`;
}

export function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/** Formats a measured value exactly; never rounds a missing value to zero. */
export function formatMeasured(value: number | null | undefined, unit: "millisecond" | "unitless", displayValue?: string | null): string {
  if (displayValue) return displayValue;
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_REPORTED;
  return unit === "millisecond" ? `${Math.round(value).toLocaleString("en-US")} ms` : String(Number(value.toFixed(3)));
}

/** Lighthouse reports category scores 0–1; shown on its own 0–100 scale, labelled as Lighthouse's. */
export function formatLighthouseScore(score: number | null | undefined): string {
  return score === null || score === undefined ? NOT_REPORTED : `${Math.round(score * 100)} / 100`;
}

export function display(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return NOT_REPORTED;
  return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
}

export interface FindingGroup {
  category: FindingCategory;
  severities: Array<{ severity: FindingSeverity; findings: AuditFinding[] }>;
  total: number;
}

export function groupFindings(findings: readonly AuditFinding[]): FindingGroup[] {
  return CATEGORY_ORDER.map((category) => {
    const inCategory = findings.filter((finding) => finding.category === category);
    return {
      category,
      total: inCategory.length,
      severities: SEVERITY_ORDER.map((severity) => ({ severity, findings: inCategory.filter((finding) => finding.severity === severity) })).filter((group) => group.findings.length > 0),
    };
  });
}

export function findingAnchor(findingId: string): string {
  let hash = 5381;
  for (let index = 0; index < findingId.length; index += 1) hash = ((hash * 33) ^ findingId.charCodeAt(index)) >>> 0;
  const slug = findingId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return `finding-${slug}-${hash.toString(36)}`;
}

export function interpretationByFinding(issues: readonly InterpretedIssue[]): Map<string, InterpretedIssue> {
  const map = new Map<string, InterpretedIssue>();
  for (const issue of issues) for (const findingId of issue.findingIds) map.set(findingId, issue);
  return map;
}

export function screenshotSrc(base64: string | undefined): string | null {
  return base64 && /^[A-Za-z0-9+/=]+$/.test(base64) ? `data:image/jpeg;base64,${base64}` : null;
}

const finiteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Formats a time; returns null for missing, null, negative or non-numeric input so callers can hide it. */
export function formatMs(value: unknown): string | null {
  return finiteNonNegative(value) ? `${Math.round(value).toLocaleString("en-US")} ms` : null;
}

/** Formats bytes in binary units (e.g. 54,693 → "53.4 KiB"); returns null when unavailable. */
export function formatBytes(value: unknown): string | null {
  if (!finiteNonNegative(value)) return null;
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KiB", "MiB", "GiB"];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit += 1; }
  return `${scaled.toFixed(1)} ${units[unit]}`;
}

const SAVINGS_METRIC_LABEL: Record<string, string> = { FCP: "First Contentful Paint", LCP: "Largest Contentful Paint", TBT: "Total Blocking Time", CLS: "Cumulative Layout Shift", INP: "Interaction to Next Paint" };

/**
 * Lighthouse savings estimates as label/value rows. Unavailable values are omitted entirely;
 * an explicit zero reported by Lighthouse is kept.
 */
export function lighthouseSavingsRows(evidence: { estimatedSavings?: Record<string, unknown>; estimatedSavingsMs?: unknown; estimatedSavingsBytes?: unknown }): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (const [metric, raw] of Object.entries(evidence.estimatedSavings ?? {})) {
    const value = metric === "CLS" ? (finiteNonNegative(raw) ? String(Number(raw.toFixed(3))) : null) : formatMs(raw);
    if (value !== null) rows.push({ label: `Est. ${SAVINGS_METRIC_LABEL[metric] ?? metric} saving`, value });
  }
  const ms = formatMs(evidence.estimatedSavingsMs);
  if (ms !== null) rows.push({ label: "Est. overall time saving", value: ms });
  const bytes = formatBytes(evidence.estimatedSavingsBytes);
  if (bytes !== null) rows.push({ label: "Est. transfer size saving", value: bytes });
  return rows;
}

/** Findings that report the same rule for the same URL under a different PageSpeed strategy. */
export function strategyCounterparts(findings: readonly AuditFinding[]): Map<string, AuditFinding[]> {
  const byKey = new Map<string, AuditFinding[]>();
  for (const finding of findings) {
    if (!findingStrategy(finding)) continue;
    const key = `${finding.category}\u0000${finding.source.ruleId}\u0000${finding.affectedUrl}`;
    byKey.set(key, [...(byKey.get(key) ?? []), finding]);
  }
  const result = new Map<string, AuditFinding[]>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const finding of group) result.set(finding.id, group.filter((other) => other.id !== finding.id));
  }
  return result;
}

export function findingStrategy(finding: AuditFinding): "mobile" | "desktop" | null {
  return finding.evidence.kind === "metric" || finding.evidence.kind === "lighthouse-audit" ? finding.evidence.strategy : null;
}
