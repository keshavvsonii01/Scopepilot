/**
 * Phase 4 audit intelligence contracts.
 *
 * Measurements (`ModuleRun.measurements`) hold values collected by deterministic tools exactly as reported.
 * Findings are derived from those measurements by documented rules (see docs/audit-intelligence.md).
 * No aggregate ScopePilot score exists; `performanceScore` is Lighthouse's own reported category score.
 */

export type AnalysisModuleId = "seo" | "performance" | "accessibility";
export type FindingCategory = AnalysisModuleId;
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
/** `measured`: a tool measured the value. `rule-based`: a deterministic rule observed it in the captured document. */
export type FindingBasis = "measured" | "rule-based";
/**
 * completed: ran over all available inputs. partial: some inputs failed or some data is missing.
 * failed: ran and produced no usable result. unavailable: not configured in this environment.
 * skipped: not requested for this audit.
 */
export type ModuleStatus = "completed" | "partial" | "failed" | "unavailable" | "skipped";

export interface ModuleIssue {
  code: string;
  message: string;
  url?: string;
  strategy?: PageSpeedStrategy;
}

export interface ModuleRun<M> {
  status: ModuleStatus;
  measurements: M | null;
  issues: ModuleIssue[];
  /** Scope and limitation statements that apply to every finding from this module. */
  notes: string[];
  findingCount: number;
}

export interface FindingSource {
  tool: "scopepilot-seo-rules" | "pagespeed-insights" | "axe-core";
  ruleId: string;
  version?: string;
}

export interface PageSignalEvidence {
  kind: "page-signal";
  signal: string;
  observed: string | number | boolean | null;
  expected: string;
  samples?: string[];
  sampleTotal?: number;
  relatedUrls?: string[];
}

export interface MetricEvidence {
  kind: "metric";
  metric: LabMetricId | FieldMetricId;
  dataSource: "lab" | "field";
  strategy: PageSpeedStrategy;
  value: number;
  unit: MetricUnit;
  displayValue?: string;
  /** Lighthouse's per-audit score (0–1) for lab metrics. */
  lighthouseScore?: number;
  /** Chrome UX Report category for field metrics. */
  fieldCategory?: FieldCategory;
  fieldScope?: "url" | "origin";
}

export interface LighthouseAuditEvidence {
  kind: "lighthouse-audit";
  auditId: string;
  strategy: PageSpeedStrategy;
  lighthouseScore: number;
  displayValue?: string;
  /** Lighthouse-estimated savings, keyed by metric acronym (e.g. LCP, FCP, TBT, CLS). */
  estimatedSavings?: Record<string, number>;
  estimatedSavingsMs?: number;
  estimatedSavingsBytes?: number;
}

export interface AxeNodeEvidence {
  target: string;
  html: string;
  failureSummary: string | null;
}

export interface AxeViolationEvidence {
  kind: "axe-violation";
  ruleId: string;
  impact: AxeImpact | null;
  wcagTags: string[];
  nodes: AxeNodeEvidence[];
  totalNodes: number;
}

export type FindingEvidence = PageSignalEvidence | MetricEvidence | LighthouseAuditEvidence | AxeViolationEvidence;

export interface AuditFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  basis: FindingBasis;
  title: string;
  source: FindingSource;
  affectedUrl: string;
  evidence: FindingEvidence;
  explanation: string;
  remediation: string;
  references: string[];
}

// SEO measurements

export interface SeoPageMeasurement {
  url: string;
  httpStatus: number | null;
  finalUrl: string | null;
  titleLength: number | null;
  metaDescriptionLength: number | null;
  h1Count: number;
  headingCount: number;
  canonical: string | null;
  robots: string | null;
  xRobotsTag: string | null;
  /** `<img>` elements in the HTML captured with JavaScript disabled. */
  imageCount: number;
  /** `<img>` elements with no usable alt (absent or whitespace-only) that are not marked decorative. */
  imagesMissingAlt: number;
  /** `<img>` elements marked decorative (`alt=""` or role="presentation"/"none"). Absent on audits before this field existed. */
  imagesDecorative?: number;
  /** Same-origin link occurrences on the page, including links back to the page itself. */
  internalLinkCount: number;
  /** Distinct same-origin link targets other than the page itself. Absent on audits before this field existed. */
  internalLinkTargetCount?: number;
  externalLinkCount: number;
}

export interface SeoMeasurements {
  pages: SeoPageMeasurement[];
  coverage: {
    pagesAnalyzed: number;
    pagesNotLoaded: string[];
    internalLinksDiscovered: number;
    internalLinksRequested: number;
  };
}

// Performance measurements

export type PageSpeedStrategy = "mobile" | "desktop";
export type LabMetricId = "first-contentful-paint" | "largest-contentful-paint" | "total-blocking-time" | "cumulative-layout-shift" | "speed-index";
export type FieldMetricId = "LARGEST_CONTENTFUL_PAINT_MS" | "INTERACTION_TO_NEXT_PAINT" | "CUMULATIVE_LAYOUT_SHIFT_SCORE" | "FIRST_CONTENTFUL_PAINT_MS" | "EXPERIMENTAL_TIME_TO_FIRST_BYTE";
export type FieldCategory = "FAST" | "AVERAGE" | "SLOW";
export type MetricUnit = "millisecond" | "unitless";

export interface LabMetric {
  value: number;
  unit: MetricUnit;
  displayValue: string | null;
  score: number | null;
}

export interface FieldMetric {
  /** Value exactly as reported by PageSpeed Insights (CLS is reported multiplied by 100). */
  percentile: number;
  /** Percentile converted to the metric's natural unit (CLS divided by 100). */
  value: number;
  unit: MetricUnit;
  category: FieldCategory;
}

export interface FieldData {
  scope: "url" | "origin";
  overallCategory: FieldCategory | null;
  metrics: Partial<Record<FieldMetricId, FieldMetric>>;
}

export interface PerformanceRun {
  strategy: PageSpeedStrategy;
  status: "completed" | "partial" | "failed";
  fetchedAt: string | null;
  finalUrl: string | null;
  lighthouseVersion: string | null;
  /** Lighthouse's own performance category score (0–1) as reported; null when not reported. */
  performanceScore: number | null;
  lab: Partial<Record<LabMetricId, LabMetric>>;
  unavailableLabMetrics: LabMetricId[];
  field: FieldData | null;
  fieldUnavailableReason: string | null;
  runWarnings: string[];
  error: ModuleIssue | null;
}

export interface PerformanceMeasurements {
  requestedUrl: string;
  runs: PerformanceRun[];
}

// Accessibility measurements

export type AxeImpact = "minor" | "moderate" | "serious" | "critical";

export interface AxeViolationRecord {
  id: string;
  impact: AxeImpact | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNodeEvidence[];
  nodeCount: number;
}

export interface AccessibilityPageRun {
  url: string;
  status: "completed" | "failed" | "skipped";
  error: ModuleIssue | null;
  violations: AxeViolationRecord[];
  /** Rules axe-core could not decide automatically; these need manual review and are not reported as findings. */
  incompleteRuleIds: string[];
  passedRuleCount: number;
  inapplicableRuleCount: number;
}

export interface AccessibilityMeasurements {
  engine: { name: "axe-core"; version: string | null };
  ruleTags: string[];
  renderMode: "javascript-disabled";
  pages: AccessibilityPageRun[];
}

export interface AuditAnalysis {
  modules: {
    seo: ModuleRun<SeoMeasurements>;
    performance: ModuleRun<PerformanceMeasurements>;
    accessibility: ModuleRun<AccessibilityMeasurements>;
  };
  findings: AuditFinding[];
}
