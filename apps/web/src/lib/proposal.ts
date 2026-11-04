import type { AuditFinding } from "@scopepilot/contracts/analysis";
import type { InterpretationContent } from "@scopepilot/contracts/interpretation";
import {
  proposalTotal,
  resolveSelections,
  type AiProposalDraft,
  type ContentOrigin,
  type OpportunitySelection,
  type Proposal,
  type ProposalContent,
  type ProposalOpportunity,
  type ProposalStatus,
  type UpdateProposalInput,
} from "@scopepilot/contracts/proposal";

/** Lets report components show "Add to proposal" controls without owning selection state. */
export interface SelectionControl {
  isSelected(selection: OpportunitySelection): boolean;
  toggle(selection: OpportunitySelection): void;
  /** Labels of other selected items that already include this item's findings. */
  coveredBy?(selection: OpportunitySelection): string[];
}

export function selectionKey(selection: OpportunitySelection): string {
  return `${selection.source}:${selection.ref}`;
}

export interface SelectedItem {
  key: string;
  selection: OpportunitySelection;
  /** Null when the selection no longer matches the audit or interpretation. */
  opportunity: ProposalOpportunity | null;
}

/** Resolves each selection independently so one stale item does not hide the others. */
export function describeSelections(selections: OpportunitySelection[], findings: AuditFinding[], interpretation: { startedAt: string; content: InterpretationContent | null } | null): SelectedItem[] {
  return selections.map((selection) => {
    const resolved = resolveSelections([selection], findings, interpretation);
    return { key: selectionKey(selection), selection, opportunity: resolved.ok ? resolved.opportunities[0]! : null };
  });
}

/** Adds the selection when absent, removes it when present. */
export function toggleSelection(current: OpportunitySelection[], selection: OpportunitySelection): OpportunitySelection[] {
  const key = selectionKey(selection);
  return current.some((item) => selectionKey(item) === key) ? current.filter((item) => selectionKey(item) !== key) : [...current, selection];
}

const SELECTION_SOURCES = new Set<string>(["finding", "ai-issue", "ai-opportunity"]);
const MAX_STORED_SELECTIONS = 200;
type SelectionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function selectionStorageKey(auditId: string): string {
  return `scopepilot:selections:${auditId}`;
}

/** Reads draft selections kept across a refresh. Holds only finding/AI references, never credentials. Invalid data is ignored. */
export function loadStoredSelections(storage: SelectionStorage | undefined, auditId: string): OpportunitySelection[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(selectionStorageKey(auditId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: OpportunitySelection[] = [];
    for (const item of parsed.slice(0, MAX_STORED_SELECTIONS)) {
      if (typeof item !== "object" || item === null) continue;
      const { source, ref } = item as Record<string, unknown>;
      if (typeof source !== "string" || !SELECTION_SOURCES.has(source) || typeof ref !== "string" || !ref || ref.length > 200) continue;
      const selection = { source, ref } as OpportunitySelection;
      if (seen.has(selectionKey(selection))) continue;
      seen.add(selectionKey(selection));
      result.push(selection);
    }
    return result;
  } catch {
    return [];
  }
}

export function storeSelections(storage: SelectionStorage | undefined, auditId: string, selections: OpportunitySelection[]): void {
  try {
    if (selections.length === 0) storage?.removeItem(selectionStorageKey(auditId));
    else storage?.setItem(selectionStorageKey(auditId), JSON.stringify(selections.map(({ source, ref }) => ({ source, ref }))));
  } catch {
    // Storage may be unavailable (private mode, quota); selections then last only for this page view.
  }
}

/** The single source of truth every "Add to proposal" control in the report reads from. */
export function selectionControl(selections: OpportunitySelection[], findings: AuditFinding[], interpretation: { startedAt: string; content: InterpretationContent | null } | null, toggle: (selection: OpportunitySelection) => void): SelectionControl {
  const keys = new Set(selections.map(selectionKey));
  const selected = describeSelections(selections, findings, interpretation);
  return {
    isSelected: (selection) => keys.has(selectionKey(selection)),
    coveredBy: (selection) => coveringSelections(selection, selected, findings, interpretation),
    toggle,
  };
}

function coverLabel(item: SelectedItem): string {
  if (item.selection.source === "finding") return "a selected audit finding";
  if (item.selection.source === "ai-issue") return `AI ${item.selection.ref}`;
  return `AI service “${item.opportunity?.title ?? item.selection.ref}”`;
}

/**
 * Other selected items whose findings overlap the target's. Findings, AI issues and AI services are
 * separate selections, so this lets every control show when its evidence is already in the proposal.
 */
export function coveringSelections(target: OpportunitySelection, selected: SelectedItem[], findings: AuditFinding[], interpretation: { startedAt: string; content: InterpretationContent | null } | null): string[] {
  const resolved = resolveSelections([target], findings, interpretation);
  if (!resolved.ok) return [];
  const ids = new Set(resolved.opportunities[0]!.findingIds);
  const key = selectionKey(target);
  return [...new Set(selected.filter((item) => item.key !== key && item.opportunity?.findingIds.some((id) => ids.has(id))).map(coverLabel))];
}

export const SOURCE_LABEL: Record<ProposalOpportunity["source"], string> = {
  finding: "Audit finding",
  "ai-issue": "AI-interpreted issue",
  "ai-opportunity": "AI-suggested service",
};

export const ORIGIN_LABEL: Record<ContentOrigin, string> = {
  user: "Entered by you",
  "rule-based": "From audit finding",
  "ai-suggestion": "AI suggestion — review",
};

export const STATUS_LABEL: Record<ProposalStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected" };

export function statusTone(status: ProposalStatus): "neutral" | "lime" | "blue" | "amber" | "danger" {
  return status === "accepted" ? "lime" : status === "sent" ? "blue" : status === "rejected" ? "danger" : "neutral";
}

export function formatMoney(amount: number | null, currency: string): string {
  if (amount === null) return "Not set";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}

export function newItemId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function contentOf(proposal: Proposal): ProposalContent {
  const { title, client, overview, objectives, scope, deliverables, milestones, pricing, terms } = proposal;
  return structuredClone({ title, client, overview, objectives, scope, deliverables, milestones, pricing, terms });
}

/** Editor state: the editable content plus the opportunity list (which may shrink before saving). */
export interface ProposalDraftState {
  status: ProposalStatus;
  content: ProposalContent;
  opportunityIds: string[];
}

export function editorState(proposal: Proposal): ProposalDraftState {
  return { status: proposal.status, content: contentOf(proposal), opportunityIds: proposal.opportunities.map((item) => item.id) };
}

export function toUpdateInput(revision: number, state: ProposalDraftState): UpdateProposalInput {
  return { revision, status: state.status, content: state.content, opportunityIds: state.opportunityIds, addSelections: [] };
}

/** Removes an opportunity and unlinks it from deliverables. */
export function removeOpportunity(state: ProposalDraftState, opportunityId: string): ProposalDraftState {
  return {
    ...state,
    opportunityIds: state.opportunityIds.filter((id) => id !== opportunityId),
    content: { ...state.content, deliverables: state.content.deliverables.map((item) => ({ ...item, opportunityIds: item.opportunityIds.filter((id) => id !== opportunityId) })) },
  };
}

/**
 * Applies AI suggestions to the editor. Empty user fields are filled; new list items are appended.
 * Everything inserted is marked as an AI suggestion so it is labelled until the user edits it.
 */
export function applyDraft(content: ProposalContent, draft: AiProposalDraft, newId: () => string = newItemId): ProposalContent {
  return {
    ...content,
    overview: draft.overview && !content.overview.text ? { text: draft.overview, origin: "ai-suggestion" } : content.overview,
    scope: draft.scope && !content.scope.text ? { text: draft.scope, origin: "ai-suggestion" } : content.scope,
    objectives: [...content.objectives, ...draft.objectives.map((text) => ({ id: newId(), text, origin: "ai-suggestion" as const }))],
    deliverables: [...content.deliverables, ...draft.deliverables.map((item) => ({ id: newId(), title: item.title, description: item.description, opportunityIds: item.opportunityIds, origin: "ai-suggestion" as const }))],
    milestones: [...content.milestones, ...draft.milestones.map((item) => ({ id: newId(), title: item.title, description: item.description, duration: item.duration, targetDate: null, origin: "ai-suggestion" as const }))],
  };
}

export function totalOf(content: ProposalContent): number | null {
  return proposalTotal(content.pricing);
}
