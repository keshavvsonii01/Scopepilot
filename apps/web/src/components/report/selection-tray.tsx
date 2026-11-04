import Link from "next/link";
import { Badge, Button } from "@scopepilot/ui/components";
import type { ProposalSummary } from "@scopepilot/contracts/proposal";
import { SOURCE_LABEL, STATUS_LABEL, statusTone, type SelectedItem } from "@/lib/proposal";
import { findingAnchor, severityTone } from "@/lib/report";
import styles from "./report.module.css";

export interface SelectionTrayProps {
  items: SelectedItem[];
  creating: boolean;
  error: string | null;
  onRemove(key: string): void;
  onClear(): void;
  onCreate?: () => void;
  existing: ProposalSummary[] | null;
}

/**
 * Lists selected opportunities with the audit evidence that supports each one. While something is
 * selected it stays pinned to the bottom of the viewport as a compact bar.
 */
export function SelectionTray({ items, creating, error, onRemove, onClear, onCreate, existing }: SelectionTrayProps) {
  const stale = items.filter((item) => !item.opportunity).length;
  const active = items.length > 0;
  return (
    <section className={styles.tray} data-active={active || undefined} aria-labelledby="selection-heading">
      <div className={styles.trayHead}>
        <div>
          <h2 id="selection-heading">Proposal opportunities</h2>
          <p role="status">{active ? `${items.length} selected${stale ? ` · ${stale} no longer valid` : ""}` : "Nothing selected"}</p>
        </div>
        <div className={styles.actions}>
          {active && <Button tone="quiet" type="button" onClick={onClear} disabled={creating}>Clear</Button>}
          <Button tone="primary" type="button" disabled={!onCreate || creating || !active || stale > 0} onClick={onCreate}>{creating ? "Creating proposal…" : "Create proposal from selection"}</Button>
        </div>
      </div>
      {error && <p className={styles.inlineError} role="alert">{error}</p>}
      {!active && <p className={styles.aiDisclaimer}>Use “Add to proposal” on audit findings or AI recommendations. Only items backed by this audit’s findings can be selected.</p>}
      {active && (
        <details className={styles.trayDetails} open={stale > 0 || undefined}>
          <summary>Review selection and supporting evidence</summary>
          <ul className={styles.trayList}>
            {items.map(({ key, selection, opportunity }) => (
              <li key={key} className={styles.trayItem}>
                <div className={styles.trayItemHead}>
                  <div className={styles.tags}>
                    <Badge tone={selection.source === "finding" ? "neutral" : "blue"}>{SOURCE_LABEL[selection.source]}</Badge>
                    {opportunity && <Badge tone={severityTone(opportunity.severity)}>{opportunity.severity}</Badge>}
                  </div>
                  <Button tone="quiet" type="button" onClick={() => onRemove(key)} aria-label={`Remove ${opportunity?.title ?? selection.ref} from selection`}>Remove</Button>
                </div>
                {opportunity ? (
                  <>
                    <strong>{opportunity.title}</strong>
                    <p className={styles.trayEvidenceLabel}>Supporting evidence</p>
                    <ul className={styles.trayEvidence}>
                      {opportunity.evidence.map((evidence) => (
                        <li key={evidence.findingId}>
                          <a href={`#${findingAnchor(evidence.findingId)}`}>{evidence.title}</a>
                          <span> · {evidence.severity} · {evidence.basis}</span>
                          {evidence.affectedUrl && <span className={styles.url}> · {evidence.affectedUrl}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className={styles.inlineError}>{selection.ref} no longer matches this audit or its current AI interpretation. Remove it to continue.</p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!active && existing && existing.length > 0 && (
        <div className={styles.existing}>
          <p className={styles.trayEvidenceLabel}>Existing proposals for this audit</p>
          <ul>
            {existing.map((proposal) => (
              <li key={proposal.id}>
                <Link href={`/workspace/proposals/${proposal.id}`}>{proposal.title}</Link> <Badge tone={statusTone(proposal.status)}>{STATUS_LABEL[proposal.status]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
