import type { ContentOrigin, ProposalContent, ProposalOpportunity, ProposalStatus } from "@scopepilot/contracts/proposal";
import { STATUS_LABEL, formatMoney, totalOf } from "@/lib/proposal";
import { formatDate } from "@/lib/report";
import styles from "./proposal.module.css";

function AiMark({ origin }: { origin: ContentOrigin }) {
  return origin === "ai-suggestion" ? <span className={styles.aiMark} title="Drafted by AI from audit evidence. Review before sharing.">AI suggestion</span> : null;
}

function Empty({ children }: { children: string }) {
  return <p className={styles.previewEmpty}>{children}</p>;
}

export interface ProposalPreviewProps {
  content: ProposalContent;
  opportunities: ProposalOpportunity[];
  status: ProposalStatus;
  auditUrl: string;
  updatedAt?: string;
}

/** Read-only document view of the proposal as currently edited (including unsaved changes). */
export function ProposalPreview({ content, opportunities, status, auditUrl, updatedAt }: ProposalPreviewProps) {
  const { client, pricing } = content;
  const total = totalOf(content);
  const pendingAi = [content.overview, content.scope, content.terms, ...content.objectives, ...content.deliverables, ...content.milestones].filter((item) => item.origin === "ai-suggestion").length;
  const opportunityTitle = new Map(opportunities.map((item) => [item.id, item.title]));

  return (
    <article className={styles.document} aria-label="Proposal preview">
      <header className={styles.docHeader}>
        <p className={styles.docEyebrow}>Proposal · {STATUS_LABEL[status]}{updatedAt ? ` · ${formatDate(updatedAt)}` : ""}</p>
        <h2>{content.title || "Untitled proposal"}</h2>
        <dl className={styles.docMeta}>
          <div><dt>Prepared for</dt><dd>{client.businessName || <span className={styles.previewEmpty}>Business name not set</span>}</dd></div>
          {client.contactName && <div><dt>Contact</dt><dd>{client.contactName}{client.contactEmail ? ` · ${client.contactEmail}` : ""}</dd></div>}
          {!client.contactName && client.contactEmail && <div><dt>Contact</dt><dd>{client.contactEmail}</dd></div>}
          <div><dt>Website</dt><dd>{client.website || auditUrl}</dd></div>
        </dl>
      </header>

      {pendingAi > 0 && <p className={styles.docNotice} role="note">{pendingAi} AI-suggested {pendingAi === 1 ? "item has" : "items have"} not been edited. AI suggestions are drafted from audit evidence and are not facts or commitments — review each one before sharing.</p>}

      <section>
        <h3>Project overview <AiMark origin={content.overview.origin} /></h3>
        {content.overview.text ? <p className={styles.prose}>{content.overview.text}</p> : <Empty>No overview yet.</Empty>}
      </section>

      <section>
        <h3>Objectives</h3>
        {content.objectives.length ? <ol>{content.objectives.map((item) => <li key={item.id}>{item.text || <em>Empty objective</em>} <AiMark origin={item.origin} /></li>)}</ol> : <Empty>No objectives yet.</Empty>}
      </section>

      <section>
        <h3>Issues and opportunities identified</h3>
        {opportunities.length ? (
          <ul className={styles.docOpportunities}>
            {opportunities.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong> <span className={styles.docSeverity}>{item.severity}</span>
                {item.origin === "ai-suggestion" && <span className={styles.aiMark}>AI interpretation</span>}
                <p>{item.summary}</p>
                <p className={styles.docEvidence}>Evidence: {item.evidence.map((evidence) => `${evidence.title} (${evidence.affectedUrl})`).join("; ")}</p>
              </li>
            ))}
          </ul>
        ) : <Empty>No opportunities selected.</Empty>}
      </section>

      <section>
        <h3>Scope of work <AiMark origin={content.scope.origin} /></h3>
        {content.scope.text ? <p className={styles.prose}>{content.scope.text}</p> : <Empty>No scope yet.</Empty>}
      </section>

      <section>
        <h3>Deliverables</h3>
        {content.deliverables.length ? (
          <table className={styles.docTable}>
            <thead><tr><th scope="col">#</th><th scope="col">Deliverable</th><th scope="col">Addresses</th></tr></thead>
            <tbody>
              {content.deliverables.map((item, index) => (
                <tr key={item.id}>
                  <td>{String(index + 1).padStart(2, "0")}</td>
                  <td><strong>{item.title || "Untitled deliverable"}</strong> <AiMark origin={item.origin} />{item.description && <p>{item.description}</p>}</td>
                  <td>{item.opportunityIds.map((id) => opportunityTitle.get(id)).filter(Boolean).join("; ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No deliverables yet.</Empty>}
      </section>

      <section>
        <h3>Timeline and milestones</h3>
        {content.milestones.length ? (
          <ol className={styles.docMilestones}>
            {content.milestones.map((item) => (
              <li key={item.id}>
                <strong>{item.title || "Untitled milestone"}</strong> <AiMark origin={item.origin} />
                <span className={styles.docTiming}>
                  {item.duration ? `${item.duration}${item.origin === "ai-suggestion" ? " (suggested estimate)" : ""}` : "Duration not set"}
                  {item.targetDate ? ` · target ${item.targetDate}` : ""}
                </span>
                {item.description && <p>{item.description}</p>}
              </li>
            ))}
          </ol>
        ) : <Empty>No milestones yet.</Empty>}
      </section>

      <section>
        <h3>Investment</h3>
        {pricing.lineItems.length ? (
          <table className={styles.docTable}>
            <thead><tr><th scope="col">Item</th><th scope="col" className={styles.amount}>Amount ({pricing.currency})</th></tr></thead>
            <tbody>
              {pricing.lineItems.map((item) => <tr key={item.id}><td>{item.label || "Unnamed item"}</td><td className={styles.amount}>{formatMoney(item.amount, pricing.currency)}</td></tr>)}
            </tbody>
            <tfoot><tr><th scope="row">Total</th><td className={styles.amount}>{formatMoney(total, pricing.currency)}</td></tr></tfoot>
          </table>
        ) : <Empty>No pricing entered.</Empty>}
        {pricing.paymentTerms ? <p className={styles.prose}><strong>Payment terms.</strong> {pricing.paymentTerms}</p> : <Empty>No payment terms entered.</Empty>}
      </section>

      <section>
        <h3>Terms and conditions <AiMark origin={content.terms.origin} /></h3>
        {content.terms.text ? <p className={styles.prose}>{content.terms.text}</p> : <Empty>No terms entered.</Empty>}
      </section>

      <footer className={styles.docFooter}>Based on a ScopePilot audit of {auditUrl}. Audit findings describe what was observed at the time of the audit; outcomes of the proposed work are not guaranteed.</footer>
    </article>
  );
}
