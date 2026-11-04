/**
 * Phase 5 AI interpretation contracts.
 *
 * AI output is an interpretation of verified findings only. It is stored separately from the
 * audit's measured results, which are never modified. Every interpreted issue points back to the
 * finding IDs it explains; text that cannot be grounded in supplied evidence is rejected, not stored.
 */
import type { FindingCategory, FindingSeverity } from "./analysis.js";
import type { AuditSummary } from "./audit.js";

export type InterpretationStatus = "generating" | "completed" | "partial" | "failed";
export type InterpretationProvider = "gemini";

export type InterpretationFailureCode =
  | "AI_NOT_CONFIGURED"
  | "AI_TIMEOUT"
  | "AI_ABORTED"
  | "AI_NETWORK_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_AUTH_FAILED"
  | "AI_REQUEST_REJECTED"
  | "AI_PROVIDER_ERROR"
  | "AI_BLOCKED"
  | "AI_EMPTY_RESPONSE"
  | "AI_OUTPUT_TRUNCATED"
  | "AI_INVALID_OUTPUT"
  | "AI_GENERATION_INTERRUPTED"
  | "NO_FINDINGS";

// Raw structured output requested from the AI provider.

export interface AiIssueInterpretation {
  /** Reference to a supplied issue group, e.g. "I3". */
  ref: string;
  plainLanguage: string;
  whyItMatters: string;
  /** Conditional business relevance; must be hedged ("may", "could", ...). */
  businessRelevance: string;
  recommendedImprovements: string[];
}

export interface AiOpportunity {
  title: string;
  summary: string;
  refs: string[];
  deliverables: string[];
}

export interface AiInterpretationOutput {
  overview: string;
  issues: AiIssueInterpretation[];
  opportunities: AiOpportunity[];
  evidenceGaps: string[];
}

// Persisted, validated interpretation.

export interface InterpretedIssue extends AiIssueInterpretation {
  category: FindingCategory;
  ruleId: string;
  title: string;
  severity: FindingSeverity;
  /** Finding IDs (from `AuditAnalysis.findings`) this interpretation explains. */
  findingIds: string[];
}

export interface InterpretedOpportunity extends AiOpportunity {
  findingIds: string[];
}

export interface InterpretationContent {
  overview: string | null;
  issues: InterpretedIssue[];
  opportunities: InterpretedOpportunity[];
  evidenceGaps: string[];
}

export interface InterpretationRejection {
  /** JSON path of the rejected item in the AI output, e.g. "issues[2]". */
  path: string;
  reason: string;
}

export interface InterpretationInputSummary {
  findingCount: number;
  issueGroupCount: number;
  /** Issue groups not sent to the AI because of the prompt size cap. */
  issueGroupsOmitted: number;
}

export interface AuditInterpretation {
  auditId: string;
  status: InterpretationStatus;
  provider: InterpretationProvider;
  model: string;
  promptVersion: string;
  startedAt: string;
  completedAt?: string;
  input?: InterpretationInputSummary;
  content: InterpretationContent | null;
  rejected: InterpretationRejection[];
  /** Supplied issue refs the AI did not interpret (or whose interpretation was rejected). */
  uninterpretedRefs: string[];
  failure?: { code: InterpretationFailureCode; message: string; retryAfterSeconds?: number };
}

export interface InterpretationResponse {
  /** Whether an AI provider is configured server-side. Never exposes the key. */
  configured: boolean;
  interpretation: AuditInterpretation | null;
}

export interface AuditListResponse {
  audits: AuditSummary[];
}

// Structural validation of raw AI output.

export const INTERPRETATION_LIMITS = {
  overview: 1_500,
  shortText: 900,
  title: 120,
  listItem: 300,
  maxIssues: 40,
  maxImprovements: 6,
  maxOpportunities: 8,
  maxDeliverables: 8,
  maxRefs: 40,
  maxEvidenceGaps: 10,
} as const;

export type StructuralParseResult =
  | { ok: true; value: AiInterpretationOutput; rejected: InterpretationRejection[] }
  | { ok: false; reason: string };

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function textList(value: unknown, maxItems: number, maxLength: number, allowEmpty: boolean): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const items = value.map((item) => text(item, maxLength));
  if (items.some((item) => item === null)) return null;
  return items.length > 0 || allowEmpty ? (items as string[]) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Validates the shape of AI output. Malformed top-level structure fails the whole response;
 * malformed individual items are dropped and reported in `rejected`.
 */
export function parseAiInterpretationOutput(value: unknown): StructuralParseResult {
  const root = record(value);
  if (!root) return { ok: false, reason: "AI output must be a JSON object." };
  if (!Array.isArray(root.issues)) return { ok: false, reason: "AI output is missing the issues array." };
  if (!Array.isArray(root.opportunities)) return { ok: false, reason: "AI output is missing the opportunities array." };
  if (!Array.isArray(root.evidenceGaps)) return { ok: false, reason: "AI output is missing the evidenceGaps array." };
  const limits = INTERPRETATION_LIMITS;
  const rejected: InterpretationRejection[] = [];

  const overview = text(root.overview, limits.overview);
  if (!overview) rejected.push({ path: "overview", reason: "Overview is missing, empty or too long." });

  const issues: AiIssueInterpretation[] = [];
  root.issues.slice(0, limits.maxIssues).forEach((item, index) => {
    const issue = record(item);
    const ref = issue ? text(issue.ref, 10) : null;
    const plainLanguage = issue ? text(issue.plainLanguage, limits.shortText) : null;
    const whyItMatters = issue ? text(issue.whyItMatters, limits.shortText) : null;
    const businessRelevance = issue ? text(issue.businessRelevance, limits.shortText) : null;
    const recommendedImprovements = issue ? textList(issue.recommendedImprovements, limits.maxImprovements, limits.listItem, false) : null;
    if (!ref || !plainLanguage || !whyItMatters || !businessRelevance || !recommendedImprovements) {
      rejected.push({ path: `issues[${index}]`, reason: "Issue interpretation is missing required fields or exceeds length limits." });
      return;
    }
    issues.push({ ref, plainLanguage, whyItMatters, businessRelevance, recommendedImprovements });
  });
  if (root.issues.length > limits.maxIssues) rejected.push({ path: "issues", reason: `Only the first ${limits.maxIssues} issue interpretations were considered.` });

  const opportunities: AiOpportunity[] = [];
  root.opportunities.slice(0, limits.maxOpportunities).forEach((item, index) => {
    const opportunity = record(item);
    const title = opportunity ? text(opportunity.title, limits.title) : null;
    const summary = opportunity ? text(opportunity.summary, limits.shortText) : null;
    const refs = opportunity ? textList(opportunity.refs, limits.maxRefs, 10, false) : null;
    const deliverables = opportunity ? textList(opportunity.deliverables, limits.maxDeliverables, limits.listItem, false) : null;
    if (!title || !summary || !refs || !deliverables) {
      rejected.push({ path: `opportunities[${index}]`, reason: "Opportunity is missing required fields or exceeds length limits." });
      return;
    }
    opportunities.push({ title, summary, refs, deliverables });
  });
  if (root.opportunities.length > limits.maxOpportunities) rejected.push({ path: "opportunities", reason: `Only the first ${limits.maxOpportunities} opportunities were considered.` });

  const evidenceGaps: string[] = [];
  root.evidenceGaps.slice(0, limits.maxEvidenceGaps).forEach((item, index) => {
    const gap = text(item, limits.shortText);
    if (gap) evidenceGaps.push(gap);
    else rejected.push({ path: `evidenceGaps[${index}]`, reason: "Evidence gap is empty or too long." });
  });

  return { ok: true, value: { overview: overview ?? "", issues, opportunities, evidenceGaps }, rejected };
}
