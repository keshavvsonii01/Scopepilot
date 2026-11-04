import type { ReactNode } from "react";
import { Badge } from "@scopepilot/ui/components";
import type { AccessibilityMeasurements, AnalysisModuleId, AuditAnalysis, ModuleRun, PerformanceMeasurements, PerformanceRun, SeoMeasurements, SeoPageMeasurement } from "@scopepilot/contracts/analysis";
import { FIELD_METRICS, LAB_METRICS, MODULE_LABEL, NOT_REPORTED, display, formatDate, formatLighthouseScore, formatMeasured, moduleStatusTone } from "@/lib/report";
import styles from "./report.module.css";

const MODULE_IDS: readonly AnalysisModuleId[] = ["seo", "performance", "accessibility"];

const STATUS_COPY: Record<ModuleRun<unknown>["status"], string> = {
  completed: "Ran over all available inputs.",
  partial: "Some inputs failed or some data is missing. Results below cover only what was measured.",
  failed: "Ran but produced no usable result.",
  unavailable: "Not configured in this environment. No results are shown or estimated.",
  skipped: "Not requested for this audit.",
};

function Missing({ children = NOT_REPORTED }: { children?: string }) {
  return <span className={styles.missing}>{children}</span>;
}

function Value({ value }: { value: string }) {
  return value === NOT_REPORTED ? <Missing /> : <>{value}</>;
}

export function ModuleStatusGrid({ analysis }: { analysis: AuditAnalysis }) {
  return (
    <section className={styles.section} aria-labelledby="modules-heading">
      <div className={styles.sectionHead}><h2 id="modules-heading">Analysis modules</h2><p>Each module runs independently; one failing does not hide the others.</p></div>
      <div className={styles.moduleGrid}>
        {MODULE_IDS.map((id) => {
          const run = analysis.modules[id];
          return (
            <article key={id} className={styles.moduleCard} aria-label={`${MODULE_LABEL[id]} module`}>
              <div className={styles.moduleCardHead}><h3>{MODULE_LABEL[id]}</h3><Badge tone={moduleStatusTone(run.status)}>{run.status}</Badge></div>
              <p>{STATUS_COPY[run.status]}</p>
              <p><span className={styles.count}>{run.findingCount}</span> finding{run.findingCount === 1 ? "" : "s"}</p>
              {run.issues.length > 0 && (
                <ul aria-label={`${MODULE_LABEL[id]} module issues`}>
                  {run.issues.map((issue, index) => <li key={index}><strong>{issue.code}</strong>: {issue.message}{issue.strategy ? ` (${issue.strategy})` : ""}{issue.url ? ` — ${issue.url}` : ""}</li>)}
                </ul>
              )}
              {run.notes.length > 0 && <ul aria-label={`${MODULE_LABEL[id]} module notes`}>{run.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function imageCell(page: SeoPageMeasurement): ReactNode {
  if (page.imageCount === 0) return <Missing>No &lt;img&gt; in captured HTML</Missing>;
  const decorative = page.imagesDecorative ? ` · ${page.imagesDecorative} decorative` : "";
  return `${page.imagesMissingAlt} of ${page.imageCount} <img>${decorative}`;
}

export function linkCell(page: SeoPageMeasurement): string {
  const occurrences = `${page.internalLinkCount} link${page.internalLinkCount === 1 ? "" : "s"}`;
  if (page.internalLinkTargetCount === undefined) return occurrences;
  return `${occurrences} · ${page.internalLinkTargetCount} other page${page.internalLinkTargetCount === 1 ? "" : "s"}`;
}

export function SeoPanel({ run }: { run: ModuleRun<SeoMeasurements> }) {
  const measurements = run.measurements;
  return (
    <section className={styles.section} aria-labelledby="seo-heading">
      <div className={styles.sectionHead}><h2 id="seo-heading">SEO measurements</h2><Badge tone={moduleStatusTone(run.status)}>{run.status}</Badge></div>
      {!measurements ? <p className={styles.missing}>No SEO measurements were recorded. {STATUS_COPY[run.status]}</p> : (
        <>
          <p className={styles.aiDisclaimer}>
            {measurements.coverage.pagesAnalyzed} page{measurements.coverage.pagesAnalyzed === 1 ? "" : "s"} analysed · {measurements.coverage.internalLinksRequested} of {measurements.coverage.internalLinksDiscovered} distinct internal link targets (other than the linking page) checked
            {measurements.coverage.pagesNotLoaded.length > 0 ? ` · not loaded: ${measurements.coverage.pagesNotLoaded.join(", ")}` : ""}
          </p>
          <p className={styles.aiDisclaimer}>Counts come from HTML captured with JavaScript disabled. “Images missing alt” counts &lt;img&gt; elements with no alt attribute (empty alt and role=&quot;presentation&quot; count as decorative); the axe-core image-alt rule below can also accept other accessible names, so the two can differ.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>URL</th><th>HTTP</th><th>Title length</th><th>Meta desc. length</th><th>H1</th><th>Canonical</th><th>Robots</th><th>Images missing alt</th><th>Internal links</th></tr></thead>
              <tbody>
                {measurements.pages.map((page) => (
                  <tr key={page.url}>
                    <td className={styles.url}>{page.url}</td>
                    <td><Value value={display(page.httpStatus)} /></td>
                    <td>{page.titleLength === null ? <Missing>Missing</Missing> : page.titleLength}</td>
                    <td>{page.metaDescriptionLength === null ? <Missing>Missing</Missing> : page.metaDescriptionLength}</td>
                    <td>{page.h1Count}</td>
                    <td className={styles.url}>{page.canonical ?? <Missing>None</Missing>}</td>
                    <td>{[page.robots, page.xRobotsTag ? `X-Robots-Tag: ${page.xRobotsTag}` : null].filter(Boolean).join(" · ") || <Missing>None</Missing>}</td>
                    <td>{imageCell(page)}</td>
                    <td>{linkCell(page)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function PerformanceRunCard({ run }: { run: PerformanceRun }) {
  return (
    <article className={styles.panel} aria-label={`PageSpeed ${run.strategy} run`}>
      <div className={styles.moduleCardHead}><h3>{run.strategy === "mobile" ? "Mobile" : "Desktop"}</h3><Badge tone={moduleStatusTone(run.status)}>{run.status}</Badge></div>
      {run.error && <p className={styles.inlineError}>{run.error.code}: {run.error.message}</p>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            <tr><th scope="row">Lighthouse performance score (as reported)</th><td><Value value={formatLighthouseScore(run.performanceScore)} /></td></tr>
            {LAB_METRICS.map(({ id, label }) => {
              const metric = run.lab[id];
              return <tr key={id}><th scope="row">{label} (lab)</th><td><Value value={metric ? formatMeasured(metric.value, metric.unit, metric.displayValue) : NOT_REPORTED} /></td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <h3>Field data (Chrome UX Report)</h3>
      {run.field ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Metric ({run.field.scope}-level)</th><th>p75</th><th>Category</th></tr></thead>
            <tbody>
              {FIELD_METRICS.map(({ id, label }) => {
                const metric = run.field?.metrics[id];
                return <tr key={id}><th scope="row">{label}</th><td><Value value={metric ? formatMeasured(metric.value, metric.unit) : NOT_REPORTED} /></td><td><Value value={metric?.category ?? NOT_REPORTED} /></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      ) : <p className={styles.missing}>{run.fieldUnavailableReason ?? "Field data was not reported."}</p>}
      <p>Fetched: {formatDate(run.fetchedAt ?? undefined)} · Lighthouse {run.lighthouseVersion ?? NOT_REPORTED}</p>
      {run.runWarnings.length > 0 && <ul aria-label="Lighthouse warnings">{run.runWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </article>
  );
}

export function PerformancePanel({ run }: { run: ModuleRun<PerformanceMeasurements> }) {
  return (
    <section className={styles.section} aria-labelledby="performance-heading">
      <div className={styles.sectionHead}><h2 id="performance-heading">Performance measurements</h2><Badge tone={moduleStatusTone(run.status)}>{run.status}</Badge></div>
      {!run.measurements || run.measurements.runs.length === 0
        ? <p className={styles.missing}>No PageSpeed Insights measurements were recorded. {STATUS_COPY[run.status]}</p>
        : (
          <>
            <p className={styles.aiDisclaimer}>Measured by Google PageSpeed Insights for {run.measurements.requestedUrl}. Lab values come from a single simulated Lighthouse run and vary between runs.</p>
            <div className={styles.runGrid}>{run.measurements.runs.map((performanceRun) => <PerformanceRunCard key={performanceRun.strategy} run={performanceRun} />)}</div>
          </>
        )}
    </section>
  );
}

export function AccessibilityPanel({ run }: { run: ModuleRun<AccessibilityMeasurements> }) {
  const measurements = run.measurements;
  return (
    <section className={styles.section} aria-labelledby="accessibility-heading">
      <div className={styles.sectionHead}><h2 id="accessibility-heading">Accessibility measurements</h2><Badge tone={moduleStatusTone(run.status)}>{run.status}</Badge></div>
      <p className={styles.aiDisclaimer}>Automated checks find only a subset of accessibility barriers. These results do not establish WCAG conformance; manual review is still required.</p>
      {!measurements ? <p className={styles.missing}>No accessibility measurements were recorded. {STATUS_COPY[run.status]}</p> : (
        <>
          <p className={styles.aiDisclaimer}>Engine: axe-core {measurements.engine.version ?? NOT_REPORTED} · rule tags: {measurements.ruleTags.join(", ")} · pages rendered with JavaScript disabled.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>URL</th><th>Status</th><th>Violated rules</th><th>Needs manual review</th><th>Passed rules</th></tr></thead>
              <tbody>
                {measurements.pages.map((page) => (
                  <tr key={page.url}>
                    <td className={styles.url}>{page.url}</td>
                    <td>{page.status}{page.error ? ` — ${page.error.message}` : ""}</td>
                    <td>{page.status === "completed" ? page.violations.length : <Missing />}</td>
                    <td>{page.status === "completed" ? page.incompleteRuleIds.length : <Missing />}</td>
                    <td>{page.status === "completed" ? page.passedRuleCount : <Missing />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
