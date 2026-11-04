import { buildAuditAnalysis } from "@scopepilot/analysis/analysis";
import { runPerformanceAnalysis } from "@scopepilot/analysis/performance";
import type { PageSpeedStrategy } from "@scopepilot/contracts/analysis";
import type { AuditResult, AuditSubmission } from "@scopepilot/contracts/audit";
import { type DnsResolver, validateCrawlTarget } from "@scopepilot/crawl-core/security";
import { createAccessibilityCollector, type AccessibilityCollectorOptions } from "./accessibility.js";
import { CRAWL_JOB_TIMEOUT_MS, inspectWebsite } from "./crawler.js";

/** Leaves room after the last axe run for screenshots before the crawl timeout. */
const ACCESSIBILITY_DEADLINE_MARGIN_MS = 10_000;

export interface AuditRunnerOptions {
  pageSpeedApiKey?: string;
  resolver?: DnsResolver;
  fetch?: typeof fetch;
  inspect?: typeof inspectWebsite;
  runAxe?: AccessibilityCollectorOptions["run"];
}

/**
 * Runs the crawl (with axe-core on each loaded page) and PageSpeed Insights in parallel, then derives findings.
 * Crawl failures still fail the audit as before; analysis-module failures are recorded and yield partial results.
 */
export async function runAudit(submission: AuditSubmission, options: AuditRunnerOptions = {}): Promise<AuditResult> {
  const root = (await validateCrawlTarget(submission.url, { resolver: options.resolver })).toString();
  const strategies: PageSpeedStrategy[] = submission.includeMobileChecks ? ["mobile", "desktop"] : ["desktop"];
  const controller = new AbortController();
  const performance = runPerformanceAnalysis({ url: root, apiKey: options.pageSpeedApiKey, strategies, fetch: options.fetch, signal: controller.signal });
  const accessibility = createAccessibilityCollector({ enabled: submission.includeAccessibilityChecks, deadline: Date.now() + CRAWL_JOB_TIMEOUT_MS - ACCESSIBILITY_DEADLINE_MARGIN_MS, run: options.runAxe });

  let crawl: AuditResult;
  try { crawl = await (options.inspect ?? inspectWebsite)(submission, options.resolver, { afterExtract: accessibility.afterExtract }); }
  catch (error) { controller.abort(); await performance; throw error; }

  return {
    ...crawl,
    analysis: buildAuditAnalysis({ rootUrl: root, pages: crawl.pages, performance: await performance, accessibility: { enabled: submission.includeAccessibilityChecks, pages: accessibility.pages } }),
  };
}
