"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, ErrorState, LoadingState } from "@scopepilot/ui/components";
import { parseProposalContent, type Proposal, type ProposalConflictResponse } from "@scopepilot/contracts/proposal";
import { ApiError, proposalApi } from "@/lib/api-client";
import { applyDraft, editorState, toUpdateInput, type ProposalDraftState } from "@/lib/proposal";
import { ExportPdfButton } from "./export-pdf-button";
import { ProposalEditor } from "./proposal-editor";
import { ProposalPreview } from "./proposal-preview";
import styles from "./proposal.module.css";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string } | { kind: "conflict"; current: Proposal };
type DraftState = { kind: "idle" } | { kind: "drafting" } | { kind: "applied"; added: number; rejected: number; partial: boolean } | { kind: "error"; message: string };

function isConflict(error: unknown): error is ApiError & { body: ProposalConflictResponse } {
  return error instanceof ApiError && error.status === 409 && typeof error.body === "object" && error.body !== null && "current" in error.body;
}

/** Validates locally with the shared contract so obvious mistakes are reported before a round trip. */
export function localValidationError(state: ProposalDraftState): string | null {
  try { parseProposalContent(state.content); return null; }
  catch (error) { return error instanceof Error ? error.message : "The proposal is not valid."; }
}

export function ProposalStudio({ proposalId }: { proposalId: string }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ProposalDraftState | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [draft, setDraft] = useState<DraftState>({ kind: "idle" });
  const [view, setView] = useState<"edit" | "preview">("edit");

  const load = useCallback((next: Proposal, configured?: boolean) => {
    setProposal(next);
    setState(editorState(next));
    if (configured !== undefined) setAiConfigured(configured);
  }, []);

  useEffect(() => {
    let cancelled = false;
    proposalApi.get(proposalId).then(
      (response) => { if (!cancelled) { load(response.proposal, response.aiDraftConfigured); setLoadError(null); } },
      (error: unknown) => { if (!cancelled) setLoadError(error instanceof ApiError ? error : new ApiError(0, "UNEXPECTED", "The proposal could not be loaded.")); },
    );
    return () => { cancelled = true; };
  }, [proposalId, attempt, load]);

  const dirty = useMemo(() => proposal !== null && state !== null && JSON.stringify(editorState(proposal)) !== JSON.stringify(state), [proposal, state]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const saveProposal = useCallback(async () => {
    if (!proposal || !state) return;
    const invalid = localValidationError(state);
    if (invalid) { setSave({ kind: "error", message: invalid }); return; }
    setSave({ kind: "saving" });
    try {
      const response = await proposalApi.update(proposal.id, toUpdateInput(proposal.revision, state));
      load(response.proposal, response.aiDraftConfigured);
      setSave({ kind: "saved", at: response.proposal.updatedAt });
    } catch (error) {
      if (isConflict(error)) setSave({ kind: "conflict", current: error.body.current });
      else setSave({ kind: "error", message: error instanceof ApiError ? error.message : "The proposal could not be saved." });
    }
  }, [proposal, state, load]);

  const requestDraft = useCallback(async () => {
    if (!proposal || !state) return;
    setDraft({ kind: "drafting" });
    try {
      const response = await proposalApi.draft(proposal.id);
      const kept = new Set(state.opportunityIds);
      const suggestion = { ...response.draft, deliverables: response.draft.deliverables.map((item) => ({ ...item, opportunityIds: item.opportunityIds.filter((id) => kept.has(id)) })) };
      const before = state.content;
      const after = applyDraft(before, suggestion);
      const added = (after.overview !== before.overview ? 1 : 0) + (after.scope !== before.scope ? 1 : 0) + suggestion.objectives.length + suggestion.deliverables.length + suggestion.milestones.length;
      setState({ ...state, content: after });
      setDraft({ kind: "applied", added, rejected: response.rejected.length, partial: response.status === "partial" });
    } catch (error) {
      setDraft({ kind: "error", message: error instanceof ApiError ? error.message : "The AI draft could not be generated." });
    }
  }, [proposal, state]);

  if (!proposal || !state) {
    if (loadError) {
      const notFound = loadError.status === 404;
      return (
        <ErrorState title={notFound ? "Proposal not found" : "The proposal could not be loaded"}>
          <p>{notFound ? "This proposal does not exist in your workspace." : loadError.message}</p>
          <p>{notFound ? <Link href="/workspace/proposals">Back to proposals</Link> : <Button tone="secondary" type="button" onClick={() => { setLoadError(null); setAttempt((value) => value + 1); }}>Retry</Button>}</p>
        </ErrorState>
      );
    }
    return <LoadingState label="Loading proposal" />;
  }

  const saving = save.kind === "saving";
  const kept = proposal.opportunities.filter((item) => state.opportunityIds.includes(item.id));

  return (
    <div className={styles.studio}>
      <header className={styles.studioHead}>
        <div>
          <p className="eyebrow">Proposal studio</p>
          <h1>{state.content.title || "Untitled proposal"}</h1>
          <p>From the audit of <Link href={`/workspace/audits/${proposal.auditId}`}>{proposal.auditUrl}</Link> · revision {proposal.revision}</p>
        </div>
        <div className={styles.saveBar} aria-live="polite">
          {dirty && save.kind !== "saving" && <Badge tone="amber">Unsaved changes</Badge>}
          {!dirty && save.kind === "saved" && <Badge tone="lime">Saved</Badge>}
          <Button tone="primary" type="button" disabled={saving || !dirty} onClick={() => void saveProposal()}>{saving ? "Saving…" : "Save proposal"}</Button>
          <ExportPdfButton proposalId={proposal.id} dirty={dirty || saving} />
        </div>
      </header>

      {save.kind === "error" && <p className={styles.alert} role="alert">Not saved: {save.message}</p>}
      {save.kind === "conflict" && (
        <div className={styles.alert} role="alert">
          <p>This proposal was changed elsewhere (now revision {save.current.revision}). Your edits were not saved.</p>
          <div className={styles.actions}>
            <Button tone="secondary" type="button" onClick={() => { load(save.current); setSave({ kind: "idle" }); }}>Load latest version (discard my edits)</Button>
            <Button tone="quiet" type="button" onClick={() => { setProposal(save.current); setSave({ kind: "idle" }); }}>Keep my edits and overwrite on next save</Button>
          </div>
        </div>
      )}

      <section className={styles.copilot} aria-labelledby="copilot-heading">
        <div>
          <h2 id="copilot-heading">AI drafting assistant</h2>
          <p>Drafts overview, objectives, scope, deliverables and milestone suggestions from the selected opportunities’ audit evidence only. Suggestions are labelled until you edit them and are not saved until you save. Pricing is never generated.</p>
        </div>
        {!aiConfigured ? (
          <p className={styles.hint}>AI drafting is unavailable: no AI provider is configured on the server.</p>
        ) : (
          <div className={styles.actions}>
            <Button tone="lime" type="button" disabled={draft.kind === "drafting" || saving || dirty || kept.length === 0} onClick={() => void requestDraft()}>{draft.kind === "drafting" ? "Drafting…" : "Draft suggestions with AI"}</Button>
            {dirty && <p className={styles.hint}>Save your changes before requesting a draft.</p>}
            {kept.length === 0 && <p className={styles.hint}>Select at least one opportunity first.</p>}
          </div>
        )}
        {draft.kind === "error" && <p className={styles.inlineError} role="alert">{draft.message}</p>}
        {draft.kind === "applied" && (
          <p className={styles.hint} role="status">
            Added {draft.added} AI {draft.added === 1 ? "suggestion" : "suggestions"} for review{draft.rejected > 0 ? `; ${draft.rejected} unsupported ${draft.rejected === 1 ? "item was" : "items were"} discarded` : ""}{draft.partial ? " (partial draft)" : ""}. Existing text was not overwritten. Save to keep them.
          </p>
        )}
      </section>

      <div className={styles.viewToggle} role="tablist" aria-label="Studio view">
        <button type="button" role="tab" aria-selected={view === "edit"} onClick={() => setView("edit")}>Editor</button>
        <button type="button" role="tab" aria-selected={view === "preview"} onClick={() => setView("preview")}>Preview</button>
      </div>

      <div className={styles.split} data-view={view}>
        <div className={styles.editorPane}>
          <ProposalEditor state={state} opportunities={proposal.opportunities} onChange={(next) => { setState(next); if (save.kind === "saved" || save.kind === "error") setSave({ kind: "idle" }); }} disabled={saving} />
        </div>
        <div className={styles.previewPane}>
          <div className={styles.previewToolbar}>
            <p className={styles.hint}>The PDF is an A4 export of the saved proposal; empty sections are left out.</p>
            <ExportPdfButton proposalId={proposal.id} dirty={dirty || saving} />
          </div>
          <ProposalPreview content={state.content} opportunities={kept} status={state.status} auditUrl={proposal.auditUrl} updatedAt={proposal.updatedAt} />
        </div>
      </div>
    </div>
  );
}
