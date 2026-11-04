import type { AuditSummary } from "@scopepilot/contracts/audit";
import { Badge, Button, EmptyState, ErrorState, LoadingState } from "@scopepilot/ui/components";
import Link from "next/link";
import { auditStatusTone, formatDate } from "@/lib/report";
import styles from "./audit-list.module.css";

export interface AuditListProps {
  audits: readonly AuditSummary[];
  state?: "ready" | "loading" | "error";
  errorMessage?: string;
  onRetry?: () => void;
}

export function AuditList({ audits, state = "ready", errorMessage, onRetry }: AuditListProps) {
  if (state === "loading") return <LoadingState label="Loading audits" />;
  if (state === "error") return <ErrorState title="Audits could not be loaded"><p>{errorMessage ?? "The audit service did not respond."}</p>{onRetry && <p><Button tone="secondary" type="button" onClick={onRetry}>Retry</Button></p>}</ErrorState>;
  if (audits.length === 0) return <EmptyState label="Audit register" title="Your first audit starts with one public URL." action={<Link href="/workspace/audits/new" className="sp-button sp-button--lime">Create an audit <span aria-hidden>→</span></Link>}><p>Submitted audits appear here with their real status, date, and finding count. Nothing has been collected yet.</p></EmptyState>;

  return <div className={styles.list} role="table" aria-label="Recent audits">
    <div className={styles.head} role="row"><span role="columnheader">Website</span><span role="columnheader">Submitted</span><span role="columnheader">Status</span><span role="columnheader">Findings</span></div>
    {audits.map((audit) => <Link key={audit.id} href={`/workspace/audits/${audit.id}`} className={styles.row} role="row"><span role="cell" className={styles.domain}>{audit.domain}</span><span role="cell">{formatDate(audit.createdAt)}</span><span role="cell"><Badge tone={auditStatusTone(audit.status)}>{audit.status}</Badge></span><span role="cell">{audit.findingCount ?? "—"}</span></Link>)}
  </div>;
}
