import { Fragment } from "react";
import { Badge } from "@scopepilot/ui/components";
import type { AuditFinding, FindingEvidence } from "@scopepilot/contracts/analysis";
import type { InterpretedIssue } from "@scopepilot/contracts/interpretation";
import type { OpportunitySelection } from "@scopepilot/contracts/proposal";
import { MODULE_LABEL, NOT_REPORTED, display, findingAnchor, findingStrategy, formatMeasured, groupFindings, lighthouseSavingsRows, severityTone, strategyCounterparts } from "@/lib/report";
import type { SelectionControl } from "@/lib/proposal";
import styles from "./report.module.css";

function EvidenceView({ evidence }: { evidence: FindingEvidence }) {
  switch (evidence.kind) {
    case "page-signal":
      return (
        <div className={styles.evidence}>
          <dl>
            <dt>Signal</dt><dd>{evidence.signal}</dd>
            <dt>Observed</dt><dd>{evidence.observed === null ? "Absent" : display(evidence.observed)}</dd>
            <dt>Expected</dt><dd>{evidence.expected}</dd>
          </dl>
          {evidence.samples && evidence.samples.length > 0 && (
            <>
              <p>Samples{evidence.sampleTotal !== undefined && evidence.sampleTotal > evidence.samples.length ? ` (${evidence.samples.length} of ${evidence.sampleTotal})` : ""}:</p>
              <ul>{evidence.samples.map((sample, index) => <li key={index}>{sample}</li>)}</ul>
            </>
          )}
          {evidence.relatedUrls && evidence.relatedUrls.length > 0 && (
            <>
              <p>Related URLs:</p>
              <ul>{evidence.relatedUrls.map((url) => <li key={url}>{url}</li>)}</ul>
            </>
          )}
        </div>
      );
    case "metric":
      return (
        <div className={styles.evidence}>
          <dl>
            <dt>Metric</dt><dd>{evidence.metric}</dd>
            <dt>Source</dt><dd>{evidence.dataSource === "lab" ? "Lighthouse lab run" : `Chrome UX Report field data (${evidence.fieldScope ?? "scope not reported"})`}</dd>
            <dt>Strategy</dt><dd>{evidence.strategy}</dd>
            <dt>Value</dt><dd>{formatMeasured(evidence.value, evidence.unit, evidence.displayValue)}</dd>
            {evidence.lighthouseScore !== undefined && <><dt>Lighthouse audit score</dt><dd>{evidence.lighthouseScore}</dd></>}
            {evidence.fieldCategory && <><dt>Field category</dt><dd>{evidence.fieldCategory}</dd></>}
          </dl>
        </div>
      );
    case "lighthouse-audit":
      return (
        <div className={styles.evidence}>
          <dl>
            <dt>Lighthouse audit</dt><dd>{evidence.auditId}</dd>
            <dt>Strategy</dt><dd>{evidence.strategy}</dd>
            <dt>Audit score</dt><dd>{evidence.lighthouseScore}</dd>
            <dt>Reported</dt><dd>{evidence.displayValue ?? NOT_REPORTED}</dd>
            {lighthouseSavingsRows(evidence).map((row) => <Fragment key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></Fragment>)}
          </dl>
          <p>Savings are Lighthouse estimates for this {evidence.strategy} lab run only; values that Lighthouse did not report are not shown.</p>
        </div>
      );
    case "axe-violation":
      return (
        <div className={styles.evidence}>
          <dl>
            <dt>axe rule</dt><dd>{evidence.ruleId}</dd>
            <dt>Impact</dt><dd>{evidence.impact ?? NOT_REPORTED}</dd>
            <dt>WCAG tags</dt><dd>{evidence.wcagTags.length > 0 ? evidence.wcagTags.join(", ") : "None (not mapped to a WCAG criterion)"}</dd>
            <dt>Affected nodes</dt><dd>{evidence.totalNodes}{evidence.nodes.length < evidence.totalNodes ? ` (showing ${evidence.nodes.length})` : ""}</dd>
          </dl>
          <ul>
            {evidence.nodes.map((node, index) => (
              <li key={index}>
                <span>{node.target}</span>
                <pre>{node.html}</pre>
                {node.failureSummary && <pre>{node.failureSummary}</pre>}
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

export function SelectToggle({ selection, control, label }: { selection: OpportunitySelection; control: SelectionControl; label: string }) {
  const checked = control.isSelected(selection);
  const coveredBy = checked ? [] : control.coveredBy?.(selection) ?? [];
  const via = coveredBy.join(", ");
  return (
    <label className={styles.selectToggle} data-checked={checked || undefined} data-covered={coveredBy.length > 0 || undefined}>
      <input type="checkbox" checked={checked} onChange={() => control.toggle(selection)} aria-label={checked ? `Remove from proposal: ${label}` : `Add to proposal: ${label}${via ? ` (its findings are already included via ${via})` : ""}`} />
      <span>{checked ? "Selected for proposal" : via ? `Already included via ${via}` : "Add to proposal"}</span>
    </label>
  );
}

export function FindingCard({ finding, interpretation, selection, counterparts = [] }: { finding: AuditFinding; interpretation?: InterpretedIssue; selection?: SelectionControl; counterparts?: AuditFinding[] }) {
  const strategy = findingStrategy(finding);
  const card = (
    <details className={styles.finding} id={findingAnchor(finding.id)}>
      <summary>
        <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
        <strong>{finding.title}</strong>
        {strategy && <Badge>{strategy}</Badge>}
        <span className={styles.findingUrl}>{finding.affectedUrl}</span>
      </summary>
      <div className={styles.findingBody}>
        {counterparts.length > 0 && (
          <p className={styles.aiDisclaimer}>
            Lighthouse also reported this for {counterparts.map((other, index) => <span key={other.id}>{index > 0 ? ", " : ""}<a href={`#${findingAnchor(other.id)}`}>{findingStrategy(other)} ({other.severity})</a></span>)}. Each strategy is a separate lab measurement; values are not combined.
          </p>
        )}
        <div className={styles.tags}>
          <Badge tone={finding.basis === "measured" ? "blue" : "neutral"}>{finding.basis === "measured" ? "Measured" : "Rule-based"}</Badge>
          <Badge>{finding.source.tool}{finding.source.version ? ` ${finding.source.version}` : ""}</Badge>
          <Badge>{finding.source.ruleId}</Badge>
        </div>
        <div><h5>Affected URL</h5><p className={styles.url}>{finding.affectedUrl}</p></div>
        <div><h5>Evidence</h5><EvidenceView evidence={finding.evidence} /></div>
        <div><h5>Explanation</h5><p>{finding.explanation}</p></div>
        <div><h5>Remediation</h5><p>{finding.remediation}</p></div>
        {finding.references.length > 0 && (
          <div>
            <h5>References</h5>
            <ul>{finding.references.map((reference) => <li key={reference}><a href={reference} target="_blank" rel="noreferrer noopener">{reference}</a></li>)}</ul>
          </div>
        )}
        {interpretation && <p><a href={`#ai-${interpretation.ref}`}>View AI interpretation ({interpretation.ref})</a></p>}
      </div>
    </details>
  );
  if (!selection) return card;
  return (
    <div className={styles.selectable}>
      {card}
      <SelectToggle selection={{ source: "finding", ref: finding.id }} control={selection} label={finding.title} />
    </div>
  );
}

export function FindingsSection({ findings, interpreted, selection }: { findings: readonly AuditFinding[]; interpreted: Map<string, InterpretedIssue>; selection?: SelectionControl }) {
  const groups = groupFindings(findings);
  const counterparts = strategyCounterparts(findings);
  return (
    <section className={styles.section} aria-labelledby="findings-heading">
      <div className={styles.sectionHead}>
        <h2 id="findings-heading">Findings</h2>
        <p>{findings.length} measured or rule-based finding{findings.length === 1 ? "" : "s"}. No aggregate score is calculated.</p>
      </div>
      <nav className={styles.categoryNav} aria-label="Finding categories">
        {groups.map((group) => <a key={group.category} href={`#findings-${group.category}`}>{MODULE_LABEL[group.category]} · {group.total}</a>)}
      </nav>
      {groups.map((group) => (
        <section key={group.category} id={`findings-${group.category}`} className={styles.section} aria-label={`${MODULE_LABEL[group.category]} findings`}>
          <div className={styles.sectionHead}><h3>{MODULE_LABEL[group.category]}</h3><p>{group.total} finding{group.total === 1 ? "" : "s"}</p></div>
          {group.total === 0 ? (
            <p className={styles.missing}>No {MODULE_LABEL[group.category]} findings were produced. Check the module status above — this is not a guarantee that no issues exist.</p>
          ) : group.severities.map((severityGroup) => (
            <div key={severityGroup.severity} className={styles.severityGroup}>
              <h4>{severityGroup.severity} · {severityGroup.findings.length}</h4>
              {severityGroup.findings.map((finding) => <FindingCard key={finding.id} finding={finding} interpretation={interpreted.get(finding.id)} selection={selection} counterparts={counterparts.get(finding.id)} />)}
            </div>
          ))}
        </section>
      ))}
    </section>
  );
}
