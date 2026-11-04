"use client";

import { ErrorState } from "@scopepilot/ui/components";
import { KeyboardEvent, PointerEvent, MouseEvent, useEffect, useRef, useState } from "react";
import { ApiError, authApi, setSession } from "@/lib/api-client";
import { CreateAuditForm } from "./create-audit-form";
import styles from "./start-audit-dialog.module.css";

export const NEW_AUDIT_PATH = "/workspace/audits/new";

type Gate = { kind: "checking" } | { kind: "signed-in" } | { kind: "signed-out" } | { kind: "error" };

/** Maps a failed session lookup to what the dialog shows: only a 401 means "not signed in". */
export function gateForSessionError(error: unknown): Gate {
  return error instanceof ApiError && error.status === 401 ? { kind: "signed-out" } : { kind: "error" };
}

/**
 * Shared modal for secondary "start an audit" calls to action. Uses the native <dialog>, which makes the rest
 * of the page inert (focus trap) and closes on Escape; backdrop clicks and focus restoration are handled here.
 */
export function StartAuditDialog({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pressedBackdrop = useRef(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleClose() {
    document.documentElement.style.overflow = "";
    returnFocus.current?.focus();
    returnFocus.current = null;
    onClose();
  }

  function requestClose() {
    dialogRef.current?.close();
  }

  // Only a press that starts and ends on the backdrop closes; drags out of a text field must not.
  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    pressedBackdrop.current = event.target === event.currentTarget;
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (pressedBackdrop.current && event.target === event.currentTarget) requestClose();
    pressedBackdrop.current = false;
  }

  // Native Escape handling is skipped by some engines (e.g. Chromium's close-watcher abuse rules), so close explicitly.
  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    requestClose();
  }

  return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="start-audit-title" aria-describedby="start-audit-lede" onClose={handleClose} onKeyDown={handleKeyDown} onPointerDown={handlePointerDown} onClick={handleClick}>
    <div className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Audit request</p>
          <h2 id="start-audit-title">Start an audit</h2>
          <p id="start-audit-lede">Set an audit depth and the checks to request. Submitting queues the audit and opens its report.</p>
        </div>
        <button type="button" className={styles.close} onClick={requestClose} aria-label="Close audit dialog"><span aria-hidden>×</span></button>
      </header>
      {open && <StartAuditBody key={attempt} onCreated={requestClose} onRetry={() => setAttempt((value) => value + 1)} />}
    </div>
  </dialog>;
}

export function StartAuditBody({ onCreated, onRetry, initialGate = { kind: "checking" } }: Readonly<{ onCreated: () => void; onRetry: () => void; initialGate?: Gate }>) {
  const [gate, setGate] = useState<Gate>(initialGate);

  useEffect(() => {
    if (gate.kind !== "checking") return;
    let cancelled = false;
    authApi.session().then(
      (session) => { if (cancelled) return; setSession(session); setGate({ kind: "signed-in" }); },
      (error: unknown) => { if (!cancelled) setGate(gateForSessionError(error)); },
    );
    return () => { cancelled = true; };
  }, [gate.kind]);

  if (gate.kind === "checking") return <p className={styles.status} role="status">Checking your account…</p>;
  if (gate.kind === "signed-in") return <CreateAuditForm autoFocus onCreated={onCreated} />;
  if (gate.kind === "error") return <ErrorState title="Your account could not be checked."><p>The ScopePilot service did not respond. <button type="button" className={styles.inlineAction} onClick={onRetry}>Try again</button></p></ErrorState>;
  const next = encodeURIComponent(NEW_AUDIT_PATH);
  return <div className={styles.signedOut}>
    <p>Audits run from your workspace. Sign in or create a free account to continue; you will return to the audit form.</p>
    <div className={styles.actions}>
      <a className="button button-primary" href={`/login?next=${next}`}>Sign in <span aria-hidden>→</span></a>
      <a className="button button-secondary" href={`/register?next=${next}`}>Create an account</a>
    </div>
  </div>;
}
