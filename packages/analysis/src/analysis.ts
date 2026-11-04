import type { AccessibilityMeasurements, AuditAnalysis, PerformanceMeasurements, SeoMeasurements } from "@scopepilot/contracts/analysis";
import type { PageInspection } from "@scopepilot/contracts/audit";
import { analyzeAccessibility, type AccessibilityInput } from "./accessibility.js";
import { compareFindings, guardModule, type ModuleResult } from "./findings.js";
import { analyzeSeo } from "./seo.js";

export { type ModuleResult } from "./findings.js";

export interface BuildAnalysisInput {
  rootUrl: string;
  pages: PageInspection[];
  performance: ModuleResult<PerformanceMeasurements>;
  accessibility: AccessibilityInput;
}

/** Combines independent module results; a failure in one module never removes results from another. */
export function buildAuditAnalysis(input: BuildAnalysisInput): AuditAnalysis {
  const seo: ModuleResult<SeoMeasurements> = guardModule(() => analyzeSeo({ rootUrl: input.rootUrl, pages: input.pages }));
  const accessibility: ModuleResult<AccessibilityMeasurements> = guardModule(() => analyzeAccessibility(input.accessibility));
  return {
    modules: { seo: seo.run, performance: input.performance.run, accessibility: accessibility.run },
    findings: [...seo.findings, ...input.performance.findings, ...accessibility.findings].sort(compareFindings),
  };
}
