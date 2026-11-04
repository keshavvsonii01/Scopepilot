"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, EmptyState, ErrorState, LoadingState } from "@scopepilot/ui/components";
import type { ProposalSummary } from "@scopepilot/contracts/proposal";
import { ApiError, proposalApi } from "@/lib/api-client";
import { STATUS_LABEL, formatMoney, statusTone } from "@/lib/proposal";
import { formatDate } from "@/lib/report";
import listStyles from "../audit-list.module.css";
import styles from "./proposal.module.css";

export interface ProposalListProps {
  proposals: readonly ProposalSummary[];
  state?: "ready" | "loading" | "error";
  errorMessage?: string;
  onRetry?: () => void;
}

export function ProposalList({ proposals, state = "ready", errorMessage, onRetry }: ProposalListProps) {
  if (state === "loading") return <LoadingState label="Loading proposals" />;
  if (state === "error") return <ErrorState title="Proposals could not be loaded"><p>{errorMessage ?? "The proposal service did not respond."}</p>{onRetry && <p><Button tone="secondary" type="button" onClick={onRetry}>Retry</Button></p>}</ErrorState>;
  if (proposals.length === 0) {
    return (
      <EmptyState label="Proposal studio" title="Proposals start from audit evidence." action={<Link href="/workspace" className="sp-button sp-button--lime">Open an audit <span aria-hidden>→</span></Link>}>
        <p>Open a completed audit, select findings or AI recommendations with “Add to proposal”, then create a proposal from your selection.</p>
      </EmptyState>
    );
  }
  return (
    <div className={listStyles.list} role="table" aria-label="Proposals">
      <div className={`${listStyles.head} ${styles.listGrid}`} role="row"><span role="columnheader">Proposal</span><span role="columnheader">Updated</span><span role="columnheader">Status</span><span role="columnheader">Opportunities</span><span role="columnheader">Total</span></div>
      {proposals.map((proposal) => (
        <Link key={proposal.id} href={`/workspace/proposals/${proposal.id}`} className={`${listStyles.row} ${styles.listGrid}`} role="row">
          <span role="cell" className={listStyles.domain}>{proposal.title}{proposal.businessName && <small className={styles.listClient}>{proposal.businessName}</small>}</span>
          <span role="cell">{formatDate(proposal.updatedAt)}</span>
          <span role="cell"><Badge tone={statusTone(proposal.status)}>{STATUS_LABEL[proposal.status]}</Badge></span>
          <span role="cell">{proposal.opportunityCount}</span>
          <span role="cell">{formatMoney(proposal.total, proposal.currency)}</span>
        </Link>
      ))}
    </div>
  );
}

export function Proposals() {
  const [proposals, setProposals] = useState<readonly ProposalSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    proposalApi.list().then(
      (response) => { if (!cancelled) { setProposals(response.proposals); setState("ready"); } },
      (error: unknown) => { if (!cancelled) { setMessage(error instanceof ApiError ? error.message : undefined); setState("error"); } },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  return <ProposalList proposals={proposals} state={state} errorMessage={message} onRetry={() => { setState("loading"); setAttempt((value) => value + 1); }} />;
}
