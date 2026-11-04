import type { AuditAnalysis } from "./analysis.js";

export type AuditMode = "quick" | "standard";
export type AuditStatus = "queued" | "running" | "partial" | "completed" | "failed";

/** An audit no worker has claimed after this long is failed with QUEUE_TIMEOUT. */
export const QUEUED_AUDIT_TIMEOUT_MS = 15 * 60_000;

export interface CreateAuditInput {
  url: string;
  mode: AuditMode;
  includeMobileChecks: boolean;
  includeAccessibilityChecks: boolean;
}

export interface AuditSubmission extends CreateAuditInput {
  workspaceId: string;
}

export interface PageInspection {
  url: string;
  title: string | null;
  metaDescription: string | null;
  headings: Array<{ level: 1 | 2 | 3 | 4 | 5 | 6; text: string }>;
  canonical: string | null;
  robots: string | null;
  links: Array<{ href: string; text: string }>;
  /** One entry per `<img>` element; `src` is "" when the element has no src attribute. */
  images: Array<{ src: string; alt: string | null; role?: string | null }>;
  /** HTTP status of the final navigation response; absent for records created before Phase 4. */
  httpStatus?: number | null;
  /** URL after redirects; absent for records created before Phase 4. */
  finalUrl?: string | null;
  xRobotsTag?: string | null;
  screenshot?: { desktop?: string; mobile?: string };
  warnings: InspectionWarning[];
}

export interface InspectionWarning {
  code: "PAGE_TIMEOUT" | "PAGE_UNREACHABLE" | "SCREENSHOT_TOO_LARGE" | "SCREENSHOT_FAILED" | "PAGE_LIMIT_REACHED";
  message: string;
}

export interface AuditResult {
  pages: PageInspection[];
  warnings: InspectionWarning[];
  /** Absent for audits completed before Phase 4. */
  analysis?: AuditAnalysis;
}

export interface AuditStatusResponse {
  id: string;
  status: AuditStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failure?: { code: string; message: string };
  result?: AuditResult;
}

export interface AuditSummary {
  id: string;
  domain: string;
  createdAt: string;
  status: AuditStatus;
  findingCount?: number;
}
