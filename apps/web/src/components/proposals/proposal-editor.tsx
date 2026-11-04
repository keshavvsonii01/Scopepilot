import { useId, type ReactNode } from "react";
import { Badge, Button, TextInput } from "@scopepilot/ui/components";
import { PROPOSAL_LIMITS, PROPOSAL_STATUSES, type ContentOrigin, type ProposalContent, type ProposalOpportunity, type ProposalStatus } from "@scopepilot/contracts/proposal";
import { ORIGIN_LABEL, SOURCE_LABEL, STATUS_LABEL, formatMoney, newItemId, removeOpportunity, totalOf, type ProposalDraftState } from "@/lib/proposal";
import { severityTone } from "@/lib/report";
import styles from "./proposal.module.css";

const L = PROPOSAL_LIMITS;

function OriginBadge({ origin }: { origin: ContentOrigin }) {
  if (origin === "user") return null;
  return <Badge tone={origin === "ai-suggestion" ? "blue" : "neutral"}>{ORIGIN_LABEL[origin]}</Badge>;
}

function Card({ index, title, aside, children }: { index: string; title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.card} aria-labelledby={id}>
      <header className={styles.cardHead}>
        <h2 id={id}><span>{index}</span> {title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Field({ label, origin, hint, children }: { label: string; origin?: ContentOrigin; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}><label htmlFor={id}>{label}</label>{origin && <OriginBadge origin={origin} />}</div>
      {children(id)}
      {hint && <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={styles.textarea} rows={4} {...props} />;
}

export interface ProposalEditorProps {
  state: ProposalDraftState;
  /** Opportunities saved on the proposal; `state.opportunityIds` may hold a subset before saving. */
  opportunities: ProposalOpportunity[];
  onChange(next: ProposalDraftState): void;
  disabled?: boolean;
}

export function ProposalEditor({ state, opportunities, onChange, disabled }: ProposalEditorProps) {
  const { content } = state;
  const set = (patch: Partial<ProposalContent>) => onChange({ ...state, content: { ...content, ...patch } });
  const kept = opportunities.filter((item) => state.opportunityIds.includes(item.id));
  const total = totalOf(content);

  return (
    <fieldset className={styles.editor} disabled={disabled}>
      <legend className="sr-only">Proposal editor</legend>

      <Card index="01" title="Proposal details">
        <Field label="Proposal title">{(id) => <TextInput id={id} value={content.title} maxLength={L.title} required onChange={(event) => set({ title: event.target.value })} />}</Field>
        <Field label="Status" hint="Set manually. ScopePilot does not send or track proposals.">
          {(id) => (
            <select id={id} className={styles.select} value={state.status} onChange={(event) => onChange({ ...state, status: event.target.value as ProposalStatus })}>
              {PROPOSAL_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
            </select>
          )}
        </Field>
      </Card>

      <Card index="02" title="Client dossier">
        <div className={styles.twoUp}>
          <Field label="Business name">{(id) => <TextInput id={id} value={content.client.businessName} maxLength={L.shortText} onChange={(event) => set({ client: { ...content.client, businessName: event.target.value } })} />}</Field>
          <Field label="Contact name">{(id) => <TextInput id={id} value={content.client.contactName} maxLength={L.shortText} onChange={(event) => set({ client: { ...content.client, contactName: event.target.value } })} />}</Field>
          <Field label="Contact email">{(id) => <TextInput id={id} type="email" value={content.client.contactEmail} maxLength={254} onChange={(event) => set({ client: { ...content.client, contactEmail: event.target.value } })} />}</Field>
          <Field label="Website">{(id) => <TextInput id={id} type="url" value={content.client.website} maxLength={500} onChange={(event) => set({ client: { ...content.client, website: event.target.value } })} />}</Field>
        </div>
      </Card>

      <Card index="03" title="Selected opportunities" aside={<span className={styles.count}>{kept.length}</span>}>
        {kept.length === 0 ? (
          <p className={styles.hint}>No opportunities remain. Return to the audit to create a proposal from a new selection.</p>
        ) : (
          <ul className={styles.opportunities}>
            {kept.map((item) => (
              <li key={item.id}>
                <div className={styles.rowHead}>
                  <div className={styles.badges}>
                    <Badge tone={item.source === "finding" ? "neutral" : "blue"}>{SOURCE_LABEL[item.source]}</Badge>
                    <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
                  </div>
                  <Button tone="quiet" type="button" onClick={() => onChange(removeOpportunity(state, item.id))} aria-label={`Remove opportunity ${item.title}`}>Remove</Button>
                </div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
                <details className={styles.evidence}>
                  <summary>Supporting evidence ({item.evidence.length})</summary>
                  <ul>
                    {item.evidence.map((evidence) => <li key={evidence.findingId}><span>{evidence.title}</span> · {evidence.severity} · {evidence.basis} · <span className={styles.url}>{evidence.affectedUrl}</span> · <code>{evidence.findingId}</code></li>)}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card index="04" title="Overview & objectives">
        <Field label="Project overview" origin={content.overview.origin}>{(id) => <TextArea id={id} value={content.overview.text} maxLength={L.longText} onChange={(event) => set({ overview: { text: event.target.value, origin: "user" } })} />}</Field>
        <div className={styles.listHead}><h3>Objectives</h3><Button tone="secondary" type="button" disabled={content.objectives.length >= L.maxObjectives} onClick={() => set({ objectives: [...content.objectives, { id: newItemId(), text: "", origin: "user" }] })}>Add objective</Button></div>
        {content.objectives.length === 0 && <p className={styles.hint}>No objectives yet.</p>}
        {content.objectives.map((item, index) => (
          <div key={item.id} className={styles.item}>
            <Field label={`Objective ${index + 1}`} origin={item.origin}>{(id) => <TextArea id={id} rows={2} value={item.text} maxLength={L.itemDescription} onChange={(event) => set({ objectives: content.objectives.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value, origin: "user" } : entry) })} />}</Field>
            <Button tone="quiet" type="button" onClick={() => set({ objectives: content.objectives.filter((entry) => entry.id !== item.id) })} aria-label={`Remove objective ${index + 1}`}>Remove</Button>
          </div>
        ))}
      </Card>

      <Card index="05" title="Scope & deliverables">
        <Field label="Scope of work" origin={content.scope.origin}>{(id) => <TextArea id={id} value={content.scope.text} maxLength={L.longText} onChange={(event) => set({ scope: { text: event.target.value, origin: "user" } })} />}</Field>
        <div className={styles.listHead}><h3>Deliverables</h3><Button tone="secondary" type="button" disabled={content.deliverables.length >= L.maxDeliverables} onClick={() => set({ deliverables: [...content.deliverables, { id: newItemId(), title: "", description: "", origin: "user", opportunityIds: [] }] })}>Add deliverable</Button></div>
        {content.deliverables.length === 0 && <p className={styles.hint}>No deliverables yet.</p>}
        {content.deliverables.map((item, index) => {
          const patch = (change: Partial<typeof item>, edited = true) => set({ deliverables: content.deliverables.map((entry) => entry.id === item.id ? { ...entry, ...change, ...(edited ? { origin: "user" as const } : {}) } : entry) });
          return (
            <div key={item.id} className={styles.item}>
              <Field label={`Deliverable ${index + 1}`} origin={item.origin}>{(id) => <TextInput id={id} value={item.title} maxLength={L.shortText} onChange={(event) => patch({ title: event.target.value })} />}</Field>
              <Field label="Description">{(id) => <TextArea id={id} rows={3} value={item.description} maxLength={L.itemDescription} onChange={(event) => patch({ description: event.target.value })} />}</Field>
              {kept.length > 0 && (
                <fieldset className={styles.links}>
                  <legend>Addresses</legend>
                  {kept.map((opportunity) => (
                    <label key={opportunity.id}>
                      <input type="checkbox" checked={item.opportunityIds.includes(opportunity.id)} onChange={(event) => patch({ opportunityIds: event.target.checked ? [...item.opportunityIds, opportunity.id] : item.opportunityIds.filter((id) => id !== opportunity.id) }, false)} />
                      {opportunity.title}
                    </label>
                  ))}
                </fieldset>
              )}
              <Button tone="quiet" type="button" onClick={() => set({ deliverables: content.deliverables.filter((entry) => entry.id !== item.id) })} aria-label={`Remove deliverable ${index + 1}`}>Remove deliverable</Button>
            </div>
          );
        })}
      </Card>

      <Card index="06" title="Timeline & milestones">
        <div className={styles.listHead}><p className={styles.hint}>Durations and dates are yours to set. AI-suggested durations are estimates only.</p><Button tone="secondary" type="button" disabled={content.milestones.length >= L.maxMilestones} onClick={() => set({ milestones: [...content.milestones, { id: newItemId(), title: "", description: "", duration: "", targetDate: null, origin: "user" }] })}>Add milestone</Button></div>
        {content.milestones.length === 0 && <p className={styles.hint}>No milestones yet.</p>}
        {content.milestones.map((item, index) => {
          const patch = (change: Partial<typeof item>) => set({ milestones: content.milestones.map((entry) => entry.id === item.id ? { ...entry, ...change, origin: "user" } : entry) });
          return (
            <div key={item.id} className={styles.item}>
              <Field label={`Milestone ${index + 1}`} origin={item.origin}>{(id) => <TextInput id={id} value={item.title} maxLength={L.shortText} onChange={(event) => patch({ title: event.target.value })} />}</Field>
              <div className={styles.twoUp}>
                <Field label={item.origin === "ai-suggestion" ? "Duration (AI-suggested estimate)" : "Duration"}>{(id) => <TextInput id={id} value={item.duration} maxLength={80} placeholder="e.g. 2 weeks" onChange={(event) => patch({ duration: event.target.value })} />}</Field>
                <Field label="Target date">{(id) => <TextInput id={id} type="date" value={item.targetDate ?? ""} onChange={(event) => patch({ targetDate: event.target.value || null })} />}</Field>
              </div>
              <Field label="Description">{(id) => <TextArea id={id} rows={2} value={item.description} maxLength={L.itemDescription} onChange={(event) => patch({ description: event.target.value })} />}</Field>
              <Button tone="quiet" type="button" onClick={() => set({ milestones: content.milestones.filter((entry) => entry.id !== item.id) })} aria-label={`Remove milestone ${index + 1}`}>Remove milestone</Button>
            </div>
          );
        })}
      </Card>

      <Card index="07" title="Commercial terms" aside={<span className={styles.count}>{formatMoney(total, content.pricing.currency)}</span>}>
        <p className={styles.hint}>Pricing is entered by you. ScopePilot never generates prices.</p>
        <Field label="Currency (ISO code)">{(id) => <TextInput id={id} className={styles.currency} value={content.pricing.currency} maxLength={3} onChange={(event) => set({ pricing: { ...content.pricing, currency: event.target.value.toUpperCase() } })} />}</Field>
        <div className={styles.listHead}><h3>Line items</h3><Button tone="secondary" type="button" disabled={content.pricing.lineItems.length >= L.maxLineItems} onClick={() => set({ pricing: { ...content.pricing, lineItems: [...content.pricing.lineItems, { id: newItemId(), label: "", amount: null }] } })}>Add line item</Button></div>
        {content.pricing.lineItems.length === 0 && <p className={styles.hint}>No line items yet.</p>}
        {content.pricing.lineItems.map((item, index) => {
          const patch = (change: Partial<typeof item>) => set({ pricing: { ...content.pricing, lineItems: content.pricing.lineItems.map((entry) => entry.id === item.id ? { ...entry, ...change } : entry) } });
          return (
            <div key={item.id} className={styles.lineItem}>
              <Field label={`Item ${index + 1}`}>{(id) => <TextInput id={id} value={item.label} maxLength={L.shortText} onChange={(event) => patch({ label: event.target.value })} />}</Field>
              <Field label="Amount">{(id) => <TextInput id={id} type="number" inputMode="decimal" min={0} max={L.maxAmount} step="0.01" value={item.amount ?? ""} onChange={(event) => patch({ amount: event.target.value === "" || !Number.isFinite(event.target.valueAsNumber) ? null : event.target.valueAsNumber })} />}</Field>
              <Button tone="quiet" type="button" onClick={() => set({ pricing: { ...content.pricing, lineItems: content.pricing.lineItems.filter((entry) => entry.id !== item.id) } })} aria-label={`Remove line item ${index + 1}`}>Remove</Button>
            </div>
          );
        })}
        <Field label="Payment terms">{(id) => <TextArea id={id} rows={3} value={content.pricing.paymentTerms} maxLength={L.longText} onChange={(event) => set({ pricing: { ...content.pricing, paymentTerms: event.target.value } })} />}</Field>
        <Field label="Terms and conditions" origin={content.terms.origin}>{(id) => <TextArea id={id} rows={5} value={content.terms.text} maxLength={L.longText} onChange={(event) => set({ terms: { text: event.target.value, origin: "user" } })} />}</Field>
      </Card>
    </fieldset>
  );
}
