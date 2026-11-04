"use client";

import type { CreateAuditInput } from "@scopepilot/contracts/audit";
import { Button, ErrorState, TextInput } from "@scopepilot/ui/components";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useState } from "react";
import { ApiError, auditApi } from "@/lib/api-client";
import styles from "./create-audit-form.module.css";

function validatePublicHttpUrl(value: string): string | null {
  if (!value.trim()) return "Enter the public website URL you want to inspect.";
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return "Use an HTTP or HTTPS URL.";
    if (!parsed.hostname || parsed.hostname === "localhost") return "Use a public website URL, not a local address.";
    return null;
  } catch {
    return "Enter a complete HTTP or HTTPS URL, for example https://example.com.";
  }
}

interface CreateAuditFormProps {
  autoFocus?: boolean;
  /** Called with the new audit ID just before navigating to its report. */
  onCreated?: (auditId: string) => void;
}

export function CreateAuditForm({ autoFocus = false, onCreated }: Readonly<CreateAuditFormProps> = {}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<CreateAuditInput["mode"]>("standard");
  const [includeMobileChecks, setIncludeMobileChecks] = useState(true);
  const [includeAccessibilityChecks, setIncludeAccessibilityChecks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const urlError = validatePublicHttpUrl(url);
    if (urlError) { setError(urlError); return; }
    setError(null);
    setSubmitError(null);
    setPending(true);
    const payload: CreateAuditInput = { url: url.trim(), mode, includeMobileChecks, includeAccessibilityChecks };
    try {
      const audit = await auditApi.create(payload);
      onCreated?.(audit.id);
      router.push(`/workspace/audits/${audit.id}`);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "The audit could not be submitted.";
      const retry = caught instanceof ApiError && caught.retryAfterSeconds ? ` Try again in about ${caught.retryAfterSeconds} seconds.` : "";
      setSubmitError(`${message}${retry}`);
      setPending(false);
    }
  }

  return <form className={styles.form} onSubmit={handleSubmit} noValidate>
    <div className={styles.field}><label htmlFor="audit-url" className="eyebrow">Public website URL</label><TextInput id="audit-url" autoFocus={autoFocus} type="url" inputMode="url" autoComplete="url" placeholder="https://example.com" value={url} onChange={(event: ChangeEvent<HTMLInputElement>) => { setUrl(event.target.value); setError(null); setSubmitError(null); }} aria-invalid={Boolean(error)} aria-describedby={error ? "audit-url-error" : "audit-url-help"} />{error ? <p id="audit-url-error" className={styles.fieldError} role="alert">{error}</p> : <p id="audit-url-help" className={styles.help}>Only public HTTP/HTTPS websites can be submitted. The audit service rejects private and local network addresses.</p>}</div>
    <fieldset className={styles.fieldset}><legend className="eyebrow">Audit depth</legend><label className={mode === "quick" ? styles.selectedOption : styles.option}><input type="radio" name="mode" value="quick" checked={mode === "quick"} onChange={() => setMode("quick")} /><span><b>Quick</b><small>Homepage only</small></span></label><label className={mode === "standard" ? styles.selectedOption : styles.option}><input type="radio" name="mode" value="standard" checked={mode === "standard"} onChange={() => setMode("standard")} /><span><b>Standard</b><small>Homepage plus up to three relevant internal pages</small></span><em>Maximum 4 pages</em></label></fieldset>
    <fieldset className={styles.fieldset}><legend className="eyebrow">Checks to request</legend><label className={styles.check}><input type="checkbox" checked={includeMobileChecks} onChange={(event) => setIncludeMobileChecks(event.target.checked)} /><span><b>Mobile performance run</b><small>Adds a mobile PageSpeed Insights (Lighthouse) run alongside desktop. Requires a PageSpeed API key on the worker.</small></span></label><label className={styles.check}><input type="checkbox" checked={includeAccessibilityChecks} onChange={(event) => setIncludeAccessibilityChecks(event.target.checked)} /><span><b>Accessibility checks</b><small>Run automated axe-core rules. These do not establish WCAG conformance.</small></span></label></fieldset>
    <div className={styles.actionRow}><Button tone="lime" type="submit" disabled={pending}>{pending ? "Submitting audit…" : "Submit audit"}<span aria-hidden>→</span></Button><p>The audit is queued and processed by the worker; you will be taken to its report.</p></div>
    {submitError && <ErrorState title="The audit was not submitted."><p>{submitError}</p></ErrorState>}
  </form>;
}
