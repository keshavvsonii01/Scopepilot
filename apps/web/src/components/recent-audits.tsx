"use client";

import { useEffect, useState } from "react";
import type { AuditSummary } from "@scopepilot/contracts/audit";
import { ApiError, auditApi } from "@/lib/api-client";
import { AuditList } from "./audit-list";

export function RecentAudits() {
  const [audits, setAudits] = useState<readonly AuditSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    auditApi.list().then(
      (response) => { if (!cancelled) { setAudits(response.audits); setState("ready"); } },
      (error: unknown) => { if (!cancelled) { setMessage(error instanceof ApiError ? error.message : undefined); setState("error"); } },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  return <AuditList audits={audits} state={state} errorMessage={message} onRetry={() => { setState("loading"); setAttempt((value) => value + 1); }} />;
}
