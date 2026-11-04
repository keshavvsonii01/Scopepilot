"use client";

import { useState } from "react";
import { Button } from "@scopepilot/ui/components";
import { ApiError, proposalApi } from "@/lib/api-client";
import styles from "./proposal.module.css";

export type ExportState = { kind: "idle" } | { kind: "exporting" } | { kind: "done"; filename: string } | { kind: "error"; message: string };

export function exportErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The PDF could not be downloaded. Try again.";
  if (error.status === 404) return "This proposal is no longer available in your workspace.";
  if (error.status === 429) return `Too many PDF exports. Try again${error.retryAfterSeconds ? ` in ${Math.ceil(error.retryAfterSeconds / 60)} min` : " later"}.`;
  return error.message;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export interface ExportPdfButtonProps {
  proposalId: string;
  /** Exports always use the saved proposal, so unsaved edits block export. */
  dirty: boolean;
  initialState?: ExportState;
}

export function ExportPdfButton({ proposalId, dirty, initialState = { kind: "idle" } }: ExportPdfButtonProps) {
  const [state, setState] = useState<ExportState>(initialState);
  const exporting = state.kind === "exporting";

  async function exportPdf() {
    setState({ kind: "exporting" });
    try {
      const { blob, filename } = await proposalApi.pdf(proposalId);
      saveBlob(blob, filename);
      setState({ kind: "done", filename });
    } catch (error) {
      setState({ kind: "error", message: exportErrorMessage(error) });
    }
  }

  return (
    <div className={styles.exportPdf}>
      <Button tone="secondary" type="button" disabled={dirty || exporting} aria-busy={exporting} onClick={() => void exportPdf()}>{exporting ? "Preparing PDF…" : "Export PDF"}</Button>
      <div aria-live="polite">
        {dirty && <p className={styles.hint}>Save your changes to include them in the PDF.</p>}
        {!dirty && state.kind === "done" && <p className={styles.hint} role="status">Downloaded {state.filename}</p>}
        {state.kind === "error" && <p className={styles.inlineError} role="alert">PDF not exported: {state.message}</p>}
      </div>
    </div>
  );
}
