"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Badge, ErrorState, LoadingState } from "@scopepilot/ui/components";
import { QUEUED_AUDIT_TIMEOUT_MS, type AuditStatusResponse } from "@scopepilot/contracts/audit";
import { auditStatusTone, formatDate, hostname, interpretationByFinding, screenshotSrc } from "@/lib/report";
import type { SelectionControl } from "@/lib/proposal";
import { AccessibilityPanel, ModuleStatusGrid, PerformancePanel, SeoPanel } from "./module-panels";
import { FindingsSection } from "./findings";
import styles from "./report.module.css";

export interface AuditReportViewProps {
  audit: AuditStatusResponse;
  /** AI panel rendered after the measured report; omitted while the audit is still running. */
  aiPanel?: ReactNode;
  interpretedIssues?: Parameters<typeof interpretationByFinding>[0];
  /** Opportunity selection controls; only provided once the audit has analysis results. */
  selection?: SelectionControl;
  /** Current time for the queued-audit notice; injectable for tests. Defaults to a clock refreshed every 15 s. */
  now?: number;
}

/** A queued audit older than this is probably waiting on a stopped worker. */
export const QUEUED_WORKER_HINT_MS = 60_000;

export function AuditReportView({ audit, aiPanel, interpretedIssues = [], selection, now }: AuditReportViewProps) {
  const rootUrl = audit.result?.pages[0]?.url;
  const analysis = audit.result?.analysis;
  const inProgress = audit.status === "queued" || audit.status === "running";
  const screenshot = screenshotSrc(audit.result?.pages[0]?.screenshot?.desktop);

  return (
    <article className={styles.report}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Audit report</p>
          <h1>{rootUrl ? hostname(rootUrl) : `Audit ${audit.id}`}</h1>
          {rootUrl && <p className={styles.url}>{rootUrl}</p>}
        </div>
        <dl className={styles.meta}>
          <div><dt>Status</dt><dd><Badge tone={auditStatusTone(audit.status)}>{audit.status}</Badge></dd></div>
          <div><dt>Submitted</dt><dd>{formatDate(audit.createdAt)}</dd></div>
          {audit.startedAt && <div><dt>Started</dt><dd>{formatDate(audit.startedAt)}</dd></div>}
          {audit.completedAt && <div><dt>Finished</dt><dd>{formatDate(audit.completedAt)}</dd></div>}
        </dl>
      </header>

      {inProgress && <LoadingState label={audit.status === "queued" ? "Queued — waiting for the worker" : "Running — crawling and analysing the site"} />}

      {audit.status === "queued" && <QueuedWorkerNotice createdAt={audit.createdAt} now={now} />}

      {audit.status === "failed" && (
        <ErrorState title="This audit could not be completed">
          <p>{audit.failure ? `${audit.failure.code}: ${audit.failure.message}` : "The worker reported a failure without details."}</p>
        </ErrorState>
      )}

      {audit.status === "partial" && (
        <div className={styles.notice} role="note">
          <p><strong>Partial results.</strong> Some pages or analysis modules did not complete. Anything not measured is shown as “Not reported” and is never estimated.</p>
        </div>
      )}

      {audit.result && (
        <section className={styles.section} aria-labelledby="overview-heading">
          <div className={styles.sectionHead}><h2 id="overview-heading">Overview</h2><p>{audit.result.pages.length} page{audit.result.pages.length === 1 ? "" : "s"} inspected</p></div>
          <div className={styles.overviewGrid}>
            {screenshot ? (
              <figure className={styles.screenshot}>
                {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI captured by the worker */}
                <img src={screenshot} alt={`Desktop screenshot of ${rootUrl ?? "the audited page"}`} />
                <figcaption>Desktop capture of the first inspected page</figcaption>
              </figure>
            ) : <div className={styles.panel}><p className={styles.missing}>No screenshot was captured.</p></div>}
            <div className={styles.panel}>
              <h3>Pages inspected</h3>
              <ul>
                {audit.result.pages.map((page) => (
                  <li key={page.url} className={styles.url}>
                    {page.url} — HTTP {page.httpStatus ?? "not reported"}{page.warnings.length > 0 ? ` · ${page.warnings.map((warning) => warning.code).join(", ")}` : ""}
                  </li>
                ))}
              </ul>
              {audit.result.warnings.length > 0 && (
                <>
                  <h3>Crawl warnings</h3>
                  <ul>{audit.result.warnings.map((warning, index) => <li key={index}>{warning.code}: {warning.message}</li>)}</ul>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {audit.result && !analysis && !inProgress && (
        <div className={styles.notice} role="note"><p>This audit was recorded before analysis modules existed, so no SEO, performance or accessibility results are available. Run a new audit to analyse the site.</p></div>
      )}

      {analysis && (
        <>
          <ModuleStatusGrid analysis={analysis} />
          <FindingsSection findings={analysis.findings} interpreted={interpretationByFinding(interpretedIssues)} selection={selection} />
          <SeoPanel run={analysis.modules.seo} />
          <PerformancePanel run={analysis.modules.performance} />
          <AccessibilityPanel run={analysis.modules.accessibility} />
        </>
      )}

      {aiPanel}
    </article>
  );
}

function QueuedWorkerNotice({ createdAt, now }: { createdAt: string; now?: number }) {
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    if (now !== undefined) return;
    const update = () => setClock(Date.now());
    const first = setTimeout(update, 0);
    const timer = setInterval(update, 15_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [now]);
  const current = now ?? clock;
  if (current === null) return null;
  const queuedMs = Math.max(0, current - Date.parse(createdAt));
  if (queuedMs < QUEUED_WORKER_HINT_MS) return null;
  return (
    <div className={styles.notice} role="status">
      <p><strong>Still waiting for a worker.</strong> This audit has been queued for {Math.floor(queuedMs / 60_000)} min. The audit worker may be offline or busy. If no worker starts it within {QUEUED_AUDIT_TIMEOUT_MS / 60_000} minutes of submission it is marked as failed and can be submitted again.</p>
    </div>
  );
}