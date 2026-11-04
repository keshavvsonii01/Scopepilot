import type { AuditFinding, FieldCategory, FieldData, FieldMetric, FieldMetricId, FindingSeverity, LabMetric, LabMetricId, MetricUnit, ModuleIssue, PageSpeedStrategy, PerformanceMeasurements, PerformanceRun } from "@scopepilot/contracts/analysis";
import { findingId, moduleResult, type ModuleResult, truncate } from "./findings.js";

export const PAGESPEED_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const PAGESPEED_TIMEOUT_MS = 60_000;
const MAX_INSIGHTS_PER_RUN = 8;
const SOURCE = "pagespeed-insights" as const;

interface MetricCopy { label: string; explanation: string; remediation: string; reference: string }

const LAB_METRICS: Record<LabMetricId, MetricCopy> = {
  "first-contentful-paint": { label: "First Contentful Paint", explanation: "Time until the first text or image is painted in the Lighthouse lab run.", remediation: "Reduce render-blocking CSS/JS, improve server response time and preload critical resources.", reference: "https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint" },
  "largest-contentful-paint": { label: "Largest Contentful Paint", explanation: "Time until the largest visible image or text block is painted in the Lighthouse lab run. LCP is a Core Web Vital.", remediation: "Optimize and prioritize the LCP element (compress, size and preload the hero image), reduce render-blocking resources and server latency.", reference: "https://web.dev/articles/lcp" },
  "total-blocking-time": { label: "Total Blocking Time", explanation: "Total time the main thread was blocked by long tasks between FCP and interactivity in the lab run. TBT is the lab proxy for responsiveness (INP).", remediation: "Reduce, split or defer JavaScript; remove unused code and move heavy work off the main thread.", reference: "https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time" },
  "cumulative-layout-shift": { label: "Cumulative Layout Shift", explanation: "Amount of unexpected layout movement measured in the lab run. CLS is a Core Web Vital.", remediation: "Reserve space for images, embeds and ads with explicit dimensions, and avoid inserting content above existing content.", reference: "https://web.dev/articles/cls" },
  "speed-index": { label: "Speed Index", explanation: "How quickly content is visually populated during load in the lab run.", remediation: "Reduce render-blocking resources and the amount of work required before the first meaningful paint.", reference: "https://developer.chrome.com/docs/lighthouse/performance/speed-index" },
};
const LAB_METRIC_IDS = Object.keys(LAB_METRICS) as LabMetricId[];

const FIELD_METRICS: Record<FieldMetricId, MetricCopy & { unit: MetricUnit; divisor: number }> = {
  LARGEST_CONTENTFUL_PAINT_MS: { label: "Largest Contentful Paint", unit: "millisecond", divisor: 1, explanation: "75th-percentile LCP experienced by real Chrome users (Chrome UX Report, 28-day window).", remediation: LAB_METRICS["largest-contentful-paint"].remediation, reference: "https://web.dev/articles/lcp" },
  INTERACTION_TO_NEXT_PAINT: { label: "Interaction to Next Paint", unit: "millisecond", divisor: 1, explanation: "75th-percentile responsiveness to user interactions experienced by real Chrome users. INP is a Core Web Vital.", remediation: "Break up long JavaScript tasks, reduce event-handler work and avoid large rendering updates after interactions.", reference: "https://web.dev/articles/inp" },
  CUMULATIVE_LAYOUT_SHIFT_SCORE: { label: "Cumulative Layout Shift", unit: "unitless", divisor: 100, explanation: "75th-percentile layout shift experienced by real Chrome users.", remediation: LAB_METRICS["cumulative-layout-shift"].remediation, reference: "https://web.dev/articles/cls" },
  FIRST_CONTENTFUL_PAINT_MS: { label: "First Contentful Paint", unit: "millisecond", divisor: 1, explanation: "75th-percentile FCP experienced by real Chrome users.", remediation: LAB_METRICS["first-contentful-paint"].remediation, reference: "https://web.dev/articles/fcp" },
  EXPERIMENTAL_TIME_TO_FIRST_BYTE: { label: "Time to First Byte", unit: "millisecond", divisor: 1, explanation: "75th-percentile server response time experienced by real Chrome users.", remediation: "Improve server/hosting response time, use caching and a CDN, and reduce redirects.", reference: "https://web.dev/articles/ttfb" },
};
const FIELD_METRIC_IDS = Object.keys(FIELD_METRICS) as FieldMetricId[];
const FIELD_CATEGORIES = new Set<FieldCategory>(["FAST", "AVERAGE", "SLOW"]);

export const PERFORMANCE_NOTES = [
  "Lab values come from a single Lighthouse run per strategy via Google PageSpeed Insights and vary between runs.",
  "Only the submitted URL is measured; other inspected pages are not.",
  "Field data comes from the Chrome UX Report (real Chrome users, 28-day window) and is only present when Google has enough data.",
  "performanceScore is Lighthouse's own reported category score. ScopePilot does not compute an aggregate score.",
];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

function parseLab(audits: Json): { lab: PerformanceRun["lab"]; unavailable: LabMetricId[] } {
  const lab: PerformanceRun["lab"] = {};
  const unavailable: LabMetricId[] = [];
  for (const id of LAB_METRIC_IDS) {
    const audit = audits[id];
    const value = isObject(audit) ? num(audit.numericValue) : null;
    if (!isObject(audit) || value === null || audit.scoreDisplayMode === "error" || audit.scoreDisplayMode === "notApplicable") { unavailable.push(id); continue; }
    const metric: LabMetric = { value, unit: audit.numericUnit === "unitless" ? "unitless" : "millisecond", displayValue: str(audit.displayValue), score: num(audit.score) };
    lab[id] = metric;
  }
  return { lab, unavailable };
}

function parseFieldBlock(block: unknown, scope: FieldData["scope"]): FieldData | null {
  if (!isObject(block) || !isObject(block.metrics)) return null;
  const metrics: FieldData["metrics"] = {};
  for (const id of FIELD_METRIC_IDS) {
    const raw = block.metrics[id];
    if (!isObject(raw)) continue;
    const percentile = num(raw.percentile);
    const category = raw.category as FieldCategory;
    if (percentile === null || !FIELD_CATEGORIES.has(category)) continue;
    const metric: FieldMetric = { percentile, value: percentile / FIELD_METRICS[id].divisor, unit: FIELD_METRICS[id].unit, category };
    metrics[id] = metric;
  }
  if (!Object.keys(metrics).length) return null;
  const overall = block.overall_category as FieldCategory;
  return { scope, overallCategory: FIELD_CATEGORIES.has(overall) ? overall : null, metrics };
}

function emptyRun(strategy: PageSpeedStrategy, error: ModuleIssue): PerformanceRun {
  return { strategy, status: "failed", fetchedAt: null, finalUrl: null, lighthouseVersion: null, performanceScore: null, lab: {}, unavailableLabMetrics: [...LAB_METRIC_IDS], field: null, fieldUnavailableReason: null, runWarnings: [], error };
}

/** Converts a PageSpeed Insights v5 response body into raw measurements, recording missing data explicitly. */
export function parsePageSpeedResponse(strategy: PageSpeedStrategy, body: unknown): PerformanceRun {
  if (!isObject(body) || !isObject(body.lighthouseResult)) return emptyRun(strategy, { code: "PAGESPEED_INVALID_RESPONSE", message: "PageSpeed Insights returned a response without a Lighthouse result.", strategy });
  const lighthouse = body.lighthouseResult;
  const runtimeError = isObject(lighthouse.runtimeError) ? lighthouse.runtimeError : null;
  const base = {
    fetchedAt: str(lighthouse.fetchTime),
    finalUrl: str(lighthouse.finalDisplayedUrl) ?? str(lighthouse.finalUrl),
    lighthouseVersion: str(lighthouse.lighthouseVersion),
    runWarnings: Array.isArray(lighthouse.runWarnings) ? lighthouse.runWarnings.filter((warning): warning is string => typeof warning === "string").map((warning) => truncate(warning, 300)) : [],
  };
  if (runtimeError && str(runtimeError.code)) {
    return { ...emptyRun(strategy, { code: "LIGHTHOUSE_RUNTIME_ERROR", message: truncate(`Lighthouse could not measure the page (${String(runtimeError.code)}): ${str(runtimeError.message) ?? "no details"}`, 400), strategy }), ...base };
  }
  const { lab, unavailable } = parseLab(isObject(lighthouse.audits) ? lighthouse.audits : {});
  const performanceCategory = isObject(lighthouse.categories) && isObject(lighthouse.categories.performance) ? lighthouse.categories.performance : null;
  const loading = isObject(body.loadingExperience) ? body.loadingExperience : null;
  const field = parseFieldBlock(loading, loading?.origin_fallback === true ? "origin" : "url") ?? parseFieldBlock(body.originLoadingExperience, "origin");
  return {
    strategy,
    status: unavailable.length ? "partial" : "completed",
    ...base,
    performanceScore: performanceCategory ? num(performanceCategory.score) : null,
    lab,
    unavailableLabMetrics: unavailable,
    field,
    fieldUnavailableReason: field ? null : "The Chrome UX Report does not have enough real-user data for this URL or its origin.",
    error: null,
  };
}

function labSeverity(score: number): FindingSeverity { return score < 0.5 ? "high" : "medium"; }
function fieldSeverity(category: FieldCategory): FindingSeverity | null { return category === "SLOW" ? "high" : category === "AVERAGE" ? "medium" : null; }

function stripMarkdownLinks(text: string): { text: string; links: string[] } {
  const links: string[] = [];
  const plain = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, href: string) => { links.push(href); return label; });
  return { text: plain, links };
}

function insightFindings(body: Json, run: PerformanceRun, url: string): AuditFinding[] {
  const lighthouse = body.lighthouseResult as Json;
  const audits = isObject(lighthouse.audits) ? lighthouse.audits : {};
  const performance = isObject(lighthouse.categories) && isObject(lighthouse.categories.performance) ? lighthouse.categories.performance : null;
  const refs = performance && Array.isArray(performance.auditRefs) ? performance.auditRefs.filter(isObject) : [];
  const candidates = refs.flatMap((ref) => {
    const id = str(ref.id);
    const audit = id ? audits[id] : undefined;
    if (!id || !isObject(audit) || ref.weight !== 0 || LAB_METRIC_IDS.includes(id as LabMetricId)) return [];
    const score = num(audit.score);
    if (score === null || score >= 0.9 || !["metricSavings", "numeric", "binary"].includes(String(audit.scoreDisplayMode))) return [];
    const savings = isObject(audit.metricSavings) ? Object.fromEntries(Object.entries(audit.metricSavings).filter((entry): entry is [string, number] => (num(entry[1]) ?? 0) > 0)) : {};
    const details = isObject(audit.details) ? audit.details : {};
    const savingsMs = num(details.overallSavingsMs) ?? undefined;
    const savingsBytes = num(details.overallSavingsBytes) ?? undefined;
    if (!Object.keys(savings).length && !(savingsMs && savingsMs > 0) && !(savingsBytes && savingsBytes > 0)) return [];
    const timeSavings = Math.max(savingsMs ?? 0, savings.LCP ?? 0, savings.FCP ?? 0, savings.TBT ?? 0);
    return [{ id, audit, score, savings, savingsMs, savingsBytes, timeSavings }];
  });
  candidates.sort((a, b) => b.timeSavings - a.timeSavings || a.id.localeCompare(b.id));
  return candidates.slice(0, MAX_INSIGHTS_PER_RUN).map(({ id, audit, score, savings, savingsMs, savingsBytes }) => {
    const description = stripMarkdownLinks(str(audit.description) ?? "");
    return {
      id: findingId(`lighthouse.${id}`, run.strategy, url),
      category: "performance",
      severity: score < 0.5 ? "medium" : "low",
      basis: "measured",
      title: str(audit.title) ?? id,
      source: { tool: SOURCE, ruleId: `lighthouse.${id}`, version: run.lighthouseVersion ?? undefined },
      affectedUrl: url,
      evidence: { kind: "lighthouse-audit", auditId: id, strategy: run.strategy, lighthouseScore: score, displayValue: str(audit.displayValue) ?? undefined, estimatedSavings: Object.keys(savings).length ? savings : undefined, estimatedSavingsMs: savingsMs, estimatedSavingsBytes: savingsBytes },
      explanation: truncate(`Lighthouse flagged this ${run.strategy} diagnostic. ${description.text}`.trim(), 800),
      remediation: "Review the specific resources Lighthouse lists for this audit in the PageSpeed Insights report. Savings are Lighthouse estimates from a single lab run; actual improvement varies.",
      references: description.links,
    } satisfies AuditFinding;
  });
}

/** Derives findings from measurements using Lighthouse's own per-audit scores and Chrome UX Report categories. */
export function performanceFindings(run: PerformanceRun, url: string, body?: unknown): AuditFinding[] {
  if (run.status === "failed") return [];
  const findings: AuditFinding[] = [];
  for (const id of LAB_METRIC_IDS) {
    const metric = run.lab[id];
    if (!metric || metric.score === null || metric.score >= 0.9) continue;
    const copy = LAB_METRICS[id];
    findings.push({
      id: findingId(`lighthouse.${id}`, run.strategy, url),
      category: "performance",
      severity: labSeverity(metric.score),
      basis: "measured",
      title: `${copy.label} ${metric.score < 0.5 ? "is poor" : "needs improvement"} (${run.strategy} lab)`,
      source: { tool: SOURCE, ruleId: `lighthouse.${id}`, version: run.lighthouseVersion ?? undefined },
      affectedUrl: url,
      evidence: { kind: "metric", metric: id, dataSource: "lab", strategy: run.strategy, value: metric.value, unit: metric.unit, displayValue: metric.displayValue ?? undefined, lighthouseScore: metric.score },
      explanation: `${copy.explanation} Lighthouse scored this metric ${metric.score.toFixed(2)} (0.90+ is "good" by Lighthouse's scoring).`,
      remediation: copy.remediation,
      references: [copy.reference],
    });
  }
  if (run.field) {
    for (const id of FIELD_METRIC_IDS) {
      const metric = run.field.metrics[id];
      const severity = metric ? fieldSeverity(metric.category) : null;
      if (!metric || !severity) continue;
      const copy = FIELD_METRICS[id];
      findings.push({
        id: findingId(`crux.${id}`, run.strategy, url),
        category: "performance",
        severity,
        basis: "measured",
        title: `Real-user ${copy.label} is ${metric.category === "SLOW" ? "poor" : "in need of improvement"} (${run.strategy})`,
        source: { tool: SOURCE, ruleId: `crux.${id}` },
        affectedUrl: url,
        evidence: { kind: "metric", metric: id, dataSource: "field", strategy: run.strategy, value: metric.value, unit: metric.unit, fieldCategory: metric.category, fieldScope: run.field.scope },
        explanation: `${copy.explanation} Google categorized it as ${metric.category}.${run.field.scope === "origin" ? " This is origin-level data for the whole site, not this specific URL." : ""}`,
        remediation: copy.remediation,
        references: [copy.reference],
      });
    }
  }
  if (isObject(body) && isObject(body.lighthouseResult)) findings.push(...insightFindings(body, run, url));
  return findings;
}

export interface PerformanceOptions {
  url: string;
  apiKey: string | undefined;
  strategies: PageSpeedStrategy[];
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function sanitize(message: string, apiKey: string): string {
  return truncate(message.split(apiKey).join("[redacted]"), 300);
}

async function measure(strategy: PageSpeedStrategy, options: PerformanceOptions & { apiKey: string }): Promise<{ run: PerformanceRun; body?: unknown }> {
  const request = new URL(PAGESPEED_ENDPOINT);
  request.searchParams.set("url", options.url);
  request.searchParams.set("strategy", strategy);
  request.searchParams.set("category", "PERFORMANCE");
  request.searchParams.set("locale", "en");
  request.searchParams.set("key", options.apiKey);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? PAGESPEED_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try { response = await (options.fetch ?? fetch)(request, { signal, headers: { accept: "application/json" } }); }
  catch {
    if (timeout.aborted) return { run: emptyRun(strategy, { code: "PAGESPEED_TIMEOUT", message: "PageSpeed Insights did not respond within the time limit.", strategy }) };
    if (options.signal?.aborted) return { run: emptyRun(strategy, { code: "PAGESPEED_ABORTED", message: "The PageSpeed Insights request was cancelled because the audit stopped.", strategy }) };
    return { run: emptyRun(strategy, { code: "PAGESPEED_NETWORK_ERROR", message: "PageSpeed Insights could not be reached.", strategy }) };
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const detail = isObject(body) && isObject(body.error) ? str(body.error.message) : null;
    const code = response.status === 429 ? "PAGESPEED_RATE_LIMITED" : response.status >= 500 ? "PAGESPEED_SERVICE_ERROR" : "PAGESPEED_REQUEST_REJECTED";
    return { run: emptyRun(strategy, { code, message: sanitize(`PageSpeed Insights returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`, options.apiKey), strategy }) };
  }
  return { run: parsePageSpeedResponse(strategy, body), body };
}

/** Measures the URL with PageSpeed Insights. Never throws; failures are reported as module issues. */
export async function runPerformanceAnalysis(options: PerformanceOptions): Promise<ModuleResult<PerformanceMeasurements>> {
  if (!options.apiKey) {
    return moduleResult<PerformanceMeasurements>({ status: "unavailable", measurements: null, issues: [{ code: "PAGESPEED_NOT_CONFIGURED", message: "PAGESPEED_API_KEY is not configured for the worker, so performance was not measured. No performance data or findings exist for this audit." }], notes: PERFORMANCE_NOTES });
  }
  const apiKey = options.apiKey;
  const results = await Promise.all(options.strategies.map((strategy) => measure(strategy, { ...options, apiKey }).catch(() => ({ run: emptyRun(strategy, { code: "PAGESPEED_INVALID_RESPONSE", message: "The PageSpeed Insights response could not be processed.", strategy }) }) as { run: PerformanceRun; body?: unknown })));
  const runs = results.map((result) => result.run);
  const findings = results.flatMap((result) => { try { return performanceFindings(result.run, options.url, result.body); } catch { return []; } });
  const issues: ModuleIssue[] = runs.flatMap((run) => [
    ...(run.error ? [run.error] : []),
    ...(run.status === "partial" ? [{ code: "LAB_METRICS_MISSING", message: `Lighthouse did not report: ${run.unavailableLabMetrics.join(", ")}.`, strategy: run.strategy }] : []),
  ]);
  const status = runs.every((run) => run.status === "failed") ? "failed" : runs.every((run) => run.status === "completed") ? "completed" : "partial";
  return moduleResult({ status, measurements: { requestedUrl: options.url, runs }, issues, notes: PERFORMANCE_NOTES }, findings);
}
