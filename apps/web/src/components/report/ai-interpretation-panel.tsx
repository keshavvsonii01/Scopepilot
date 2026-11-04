import type { ReactNode } from "react";
import { Badge, Button, LoadingState } from "@scopepilot/ui/components";
import type { AuditInterpretation, InterpretationResponse } from "@scopepilot/contracts/interpretation";
import { MODULE_LABEL, findingAnchor, formatDate, severityTone } from "@/lib/report";
import type { SelectionControl } from "@/lib/proposal";
import { SelectToggle } from "./findings";
import styles from "./report.module.css";

export interface AiActionError {
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export type AiPanelState =
  | { kind: "loading" }
  | { kind: "load-error"; message: string }
  | { kind: "loaded"; response: InterpretationResponse };

export interface AiInterpretationPanelProps {
  state: AiPanelState;
  hasFindings: boolean;
  requesting: boolean;
  actionError?: AiActionError | null;
  onGenerate?: () => void;
  onRetryLoad?: () => void;
  selection?: SelectionControl;
}

function retryCopy(seconds: number | undefined): string {
  return seconds ? ` You can retry in about ${seconds} second${seconds === 1 ? "" : "s"}.` : "";
}

function InterpretationBody({ interpretation, selection }: { interpretation: AuditInterpretation; selection?: SelectionControl }) {
  const content = interpretation.content;
  if (!content) return null;
  return (
    <>
      {content.overview && <div><h3>Overview</h3><p>{content.overview}</p></div>}
      {content.issues.length > 0 && (
        <div className={styles.aiList}>
          <h3>Interpreted issues</h3>
          {content.issues.map((issue) => (
            <article key={issue.ref} id={`ai-${issue.ref}`} className={styles.aiIssue} aria-label={`AI interpretation ${issue.ref}`}>
              <div className={styles.tags}>
                <Badge tone="blue">AI · {issue.ref}</Badge>
                <Badge>{MODULE_LABEL[issue.category]}</Badge>
                <Badge tone={severityTone(issue.severity)}>{issue.severity}</Badge>
              </div>
              <h4>{issue.title}</h4>
              <dl>
                <div><dt>In plain language</dt><dd>{issue.plainLanguage}</dd></div>
                <div><dt>Why it matters</dt><dd>{issue.whyItMatters}</dd></div>
                <div><dt>Possible business relevance</dt><dd>{issue.businessRelevance}</dd></div>
                <div><dt>Recommended improvements</dt><dd><ul>{issue.recommendedImprovements.map((item, index) => <li key={index}>{item}</li>)}</ul></dd></div>
                <div>
                  <dt>Based on measured findings</dt>
                  <dd><ul>{issue.findingIds.map((findingId) => <li key={findingId}><a href={`#${findingAnchor(findingId)}`}>{findingId}</a></li>)}</ul></dd>
                </div>
              </dl>
              {selection && <SelectToggle selection={{ source: "ai-issue", ref: issue.ref }} control={selection} label={`AI ${issue.ref} ${issue.title}`} />}
            </article>
          ))}
        </div>
      )}
      {content.opportunities.length > 0 && (
        <div className={styles.aiList}>
          <h3>Suggested development services</h3>
          {content.opportunities.map((opportunity, index) => (
            <article key={index} className={styles.aiIssue} aria-label={`Suggested service ${opportunity.title}`}>
              <h4>{opportunity.title}</h4>
              <p>{opportunity.summary}</p>
              {opportunity.deliverables.length > 0 && <ul>{opportunity.deliverables.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>}
              <p className={styles.aiDisclaimer}>Addresses: {opportunity.refs.map((ref, refIndex) => <span key={ref}>{refIndex > 0 ? ", " : ""}<a href={`#ai-${ref}`}>{ref}</a></span>)}</p>
              {selection && <SelectToggle selection={{ source: "ai-opportunity", ref: `O${index}` }} control={selection} label={`AI service ${opportunity.title}`} />}
            </article>
          ))}
        </div>
      )}
      {content.evidenceGaps.length > 0 && (
        <div className={styles.aiNote}>
          <strong>Evidence gaps noted by the AI</strong>
          <ul>{content.evidenceGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
        </div>
      )}
    </>
  );
}

function ValidationNote({ interpretation }: { interpretation: AuditInterpretation }) {
  const omitted = interpretation.input?.issueGroupsOmitted ?? 0;
  if (interpretation.rejected.length === 0 && interpretation.uninterpretedRefs.length === 0 && omitted === 0) return null;
  return (
    <div className={styles.aiNote} role="note">
      <strong>Validation</strong>
      {interpretation.rejected.length > 0 && <p>{interpretation.rejected.length} AI statement{interpretation.rejected.length === 1 ? " was" : "s were"} discarded because {interpretation.rejected.length === 1 ? "it" : "they"} could not be verified against the measured evidence.</p>}
      {interpretation.uninterpretedRefs.length > 0 && <p>Not interpreted: {interpretation.uninterpretedRefs.join(", ")}. The measured findings remain available above.</p>}
      {omitted > 0 && <p>{omitted} lower-priority issue group{omitted === 1 ? " was" : "s were"} not sent to the AI because of the size limit.</p>}
      {interpretation.rejected.length > 0 && (
        <details className={styles.rejections}>
          <summary>Why items were discarded</summary>
          <ul>{interpretation.rejected.map((rejection, index) => <li key={index}><code>{rejection.path}</code>: {rejection.reason}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

export function AiInterpretationPanel({ state, hasFindings, requesting, actionError, onGenerate, onRetryLoad, selection }: AiInterpretationPanelProps) {
  const interpretation = state.kind === "loaded" ? state.response.interpretation : null;
  const configured = state.kind === "loaded" && state.response.configured;
  const generating = requesting || interpretation?.status === "generating";
  const hasContent = interpretation?.status === "completed" || interpretation?.status === "partial";

  let body: ReactNode;
  if (state.kind === "loading") body = <LoadingState label="Loading AI interpretation" />;
  else if (state.kind === "load-error") body = <div className={styles.actions}><p className={styles.inlineError}>{state.message}</p>{onRetryLoad && <Button tone="secondary" type="button" onClick={onRetryLoad}>Retry</Button>}</div>;
  else if (generating) body = <LoadingState label="Generating AI interpretation — this can take up to a minute" />;
  else if (!hasFindings) body = <p className={styles.aiDisclaimer}>There are no measured findings to interpret, so no AI interpretation is generated.</p>;
  else {
    body = (
      <>
        {interpretation?.status === "failed" && interpretation.failure && (
          <p className={styles.inlineError} role="alert">AI interpretation failed ({interpretation.failure.code}): {interpretation.failure.message}{retryCopy(interpretation.failure.retryAfterSeconds)}</p>
        )}
        {interpretation?.status === "partial" && <p className={styles.aiDisclaimer}>Partial interpretation: some AI output could not be validated and was discarded.</p>}
        {interpretation && hasContent && <InterpretationBody interpretation={interpretation} selection={selection} />}
        {interpretation && interpretation.status !== "generating" && <ValidationNote interpretation={interpretation} />}
        {!configured && <p className={styles.aiDisclaimer}>AI interpretation is not configured on this server. Set <code>GEMINI_API_KEY</code> for the API to enable it. The measured report above is complete without it.</p>}
        {configured && (
          <div className={styles.actions}>
            <Button tone="lime" type="button" onClick={onGenerate} disabled={!onGenerate}>{interpretation ? "Regenerate interpretation" : "Generate AI interpretation"}</Button>
            {interpretation && <p>Regenerating replaces the current interpretation.</p>}
          </div>
        )}
      </>
    );
  }

  return (
    <section className={styles.aiPanel} aria-labelledby="ai-heading">
      <div className={styles.aiLabel}>
        <Badge tone="blue">AI interpretation</Badge>
        <h2 id="ai-heading" className="sr-only">AI interpretation</h2>
        {interpretation && <Badge tone={interpretation.status === "failed" ? "danger" : interpretation.status === "partial" ? "amber" : interpretation.status === "completed" ? "lime" : "neutral"}>{interpretation.status}</Badge>}
      </div>
      <p className={styles.aiDisclaimer}>
        Generated text that interprets the measured findings above. It is not a measurement, introduces no new findings, and does not guarantee any ranking, traffic, conversion or revenue outcome.
      </p>
      {actionError && <p className={styles.inlineError} role="alert">{actionError.message}{retryCopy(actionError.retryAfterSeconds)}</p>}
      {body}
      {interpretation && interpretation.status !== "generating" && (
        <p className={styles.aiDisclaimer}>Model {interpretation.model} · prompt {interpretation.promptVersion} · {formatDate(interpretation.completedAt ?? interpretation.startedAt)}</p>
      )}
    </section>
  );
}
