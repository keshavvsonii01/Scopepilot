"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, ErrorState, LoadingState } from "@scopepilot/ui/components";
import type { AuditStatusResponse } from "@scopepilot/contracts/audit";
import type { OpportunitySelection, ProposalSummary } from "@scopepilot/contracts/proposal";
import { ApiError, auditApi, proposalApi } from "@/lib/api-client";
import { describeSelections, loadStoredSelections, selectionControl, selectionKey, storeSelections, toggleSelection, type SelectionControl } from "@/lib/proposal";
import { AiInterpretationPanel, type AiActionError, type AiPanelState } from "./ai-interpretation-panel";
import { AuditReportView } from "./audit-report-view";
import { SelectionTray } from "./selection-tray";

const AUDIT_POLL_MS = 3_000;
const INTERPRETATION_POLL_MS = 5_000;

function toActionError(error: unknown): AiActionError {
  return error instanceof ApiError
    ? { code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds }
    : { code: "UNEXPECTED", message: "The request failed unexpectedly." };
}

export function AuditReport({ auditId }: { auditId: string }) {
  const [audit, setAudit] = useState<AuditStatusResponse | null>(null);
  const [auditError, setAuditError] = useState<ApiError | null>(null);
  const [aiState, setAiState] = useState<AiPanelState>({ kind: "loading" });
  const [requesting, setRequesting] = useState(false);
  const [actionError, setActionError] = useState<AiActionError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [aiReloadKey, setAiReloadKey] = useState(0);
  // Selections render only after the audit is fetched client-side, so restoring here cannot cause a hydration mismatch.
  const [selections, setSelections] = useState<OpportunitySelection[]>(() => (typeof window === "undefined" ? [] : loadStoredSelections(window.sessionStorage, auditId)));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ProposalSummary[] | null>(null);
  const router = useRouter();
  const mounted = useRef(true);

  useEffect(() => {
    storeSelections(window.sessionStorage, auditId, selections);
  }, [auditId, selections]);

  const toggle = useCallback((selection: OpportunitySelection) => {
    setCreateError(null);
    setSelections((current) => toggleSelection(current, selection));
  }, []);

  useEffect(() => {
    let cancelled = false;
    proposalApi.list(auditId)
      .then((response) => { if (!cancelled) setExisting(response.proposals); })
      .catch(() => { if (!cancelled) setExisting(null); });
    return () => { cancelled = true; };
  }, [auditId]);

  const createProposal = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const response = await proposalApi.create({ auditId, selections });
      storeSelections(window.sessionStorage, auditId, []);
      router.push(`/workspace/proposals/${response.proposal.id}`);
    } catch (error) {
      if (mounted.current) setCreateError(error instanceof ApiError ? error.message : "The proposal could not be created.");
    } finally {
      if (mounted.current) setCreating(false);
    }
  }, [auditId, selections, router]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const terminal = audit !== null && audit.status !== "queued" && audit.status !== "running";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await auditApi.get(auditId);
        if (cancelled) return;
        setAudit(next);
        setAuditError(null);
        if (next.status === "queued" || next.status === "running") timer = setTimeout(load, AUDIT_POLL_MS);
      } catch (error) {
        if (!cancelled) setAuditError(error instanceof ApiError ? error : new ApiError(0, "UNEXPECTED", "The audit could not be loaded."));
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [auditId, reloadKey]);

  const interpretationStatus = aiState.kind === "loaded" ? aiState.response.interpretation?.status : undefined;

  useEffect(() => {
    if (!terminal) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await auditApi.interpretation(auditId);
        if (!cancelled) setAiState({ kind: "loaded", response });
      } catch (error) {
        if (!cancelled) setAiState({ kind: "load-error", message: error instanceof ApiError ? error.message : "The AI interpretation could not be loaded." });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [auditId, terminal, aiReloadKey]);

  useEffect(() => {
    if (interpretationStatus !== "generating" || requesting) return;
    const timer = setTimeout(() => setAiReloadKey((key) => key + 1), INTERPRETATION_POLL_MS);
    return () => clearTimeout(timer);
  }, [interpretationStatus, requesting, aiState]);

  const generate = useCallback(async () => {
    setRequesting(true);
    setActionError(null);
    try {
      const response = await auditApi.generateInterpretation(auditId);
      if (mounted.current) setAiState({ kind: "loaded", response });
    } catch (error) {
      if (!mounted.current) return;
      setActionError(toActionError(error));
      setAiReloadKey((key) => key + 1);
    } finally {
      if (mounted.current) setRequesting(false);
    }
  }, [auditId]);

  if (!audit) {
    if (auditError) {
      const notFound = auditError.status === 404;
      return (
        <ErrorState title={notFound ? "Audit not found" : "The audit could not be loaded"}>
          <p>{notFound ? "This audit does not exist in your workspace." : auditError.message}</p>
          <p>{notFound ? <Link href="/workspace">Back to audits</Link> : <Button tone="secondary" type="button" onClick={() => { setAuditError(null); setReloadKey((key) => key + 1); }}>Retry</Button>}</p>
        </ErrorState>
      );
    }
    return <LoadingState label="Loading audit" />;
  }

  const findings = audit.result?.analysis?.findings ?? [];
  const interpretation = aiState.kind === "loaded" ? aiState.response.interpretation : null;
  const hasContent = interpretation?.status === "completed" || interpretation?.status === "partial";
  const selectable = terminal && (audit.status === "completed" || audit.status === "partial") && findings.length > 0;
  const snapshot = interpretation && hasContent ? { startedAt: interpretation.startedAt, content: interpretation.content } : null;
  const selectedItems = describeSelections(selections, findings, snapshot);
  const selectionControlValue: SelectionControl | undefined = selectable ? selectionControl(selections, findings, snapshot, toggle) : undefined;

  return (
    <>
      {auditError && (
        <p role="alert">Refreshing the audit failed: {auditError.message} <Button tone="quiet" type="button" onClick={() => { setAuditError(null); setReloadKey((key) => key + 1); }}>Retry</Button></p>
      )}
      <AuditReportView
        audit={audit}
        selection={selectionControlValue}
        interpretedIssues={hasContent ? interpretation?.content?.issues ?? [] : []}
        aiPanel={terminal && audit.status !== "failed" ? (
          <AiInterpretationPanel
            state={aiState}
            hasFindings={findings.length > 0}
            requesting={requesting}
            actionError={actionError}
            onGenerate={requesting ? undefined : () => void generate()}
            onRetryLoad={() => { setAiState({ kind: "loading" }); setAiReloadKey((key) => key + 1); }}
            selection={selectionControlValue}
          />
        ) : undefined}
      />
      {selectable && (
        <SelectionTray
          items={selectedItems}
          creating={creating}
          error={createError}
          existing={existing}
          onRemove={(key) => setSelections((current) => current.filter((item) => selectionKey(item) !== key))}
          onClear={() => setSelections([])}
          onCreate={() => void createProposal()}
        />
      )}
    </>
  );
}
