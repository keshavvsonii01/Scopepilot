/**
 * Phase 6 proposal contracts.
 *
 * A proposal is built from opportunities the user selected from an audit. Every opportunity keeps
 * the finding IDs it is based on and a snapshot of their identifying evidence; the audit record is
 * never modified. Each editable piece of content records where it came from so measured,
 * rule-based, AI-suggested and user-entered values are never presented as the same thing.
 */
import type { AuditFinding, FindingBasis, FindingCategory, FindingSeverity } from "./analysis.js";
import type { InterpretationContent, InterpretationRejection } from "./interpretation.js";

/** Manually set by the user. ScopePilot does not send or track proposals. */
export type ProposalStatus = "draft" | "sent" | "accepted" | "rejected";
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ["draft", "sent", "accepted", "rejected"];

/**
 * Where a piece of proposal content came from.
 * - `rule-based`: copied from a deterministic audit finding (title, remediation).
 * - `ai-suggestion`: drafted by AI from supplied evidence; a suggestion, never a fact.
 * - `user`: entered or edited by the user.
 */
export type ContentOrigin = "user" | "rule-based" | "ai-suggestion";

export type OpportunitySource = "finding" | "ai-issue" | "ai-opportunity";

/**
 * A user's selection of something in an audit report.
 * `ref` is a finding ID, an AI issue ref (e.g. "I3") or an AI opportunity position (e.g. "O0").
 */
export interface OpportunitySelection {
  source: OpportunitySource;
  ref: string;
}

/** Identifying snapshot of a finding that supports an opportunity. */
export interface EvidenceReference {
  findingId: string;
  title: string;
  category: FindingCategory;
  severity: FindingSeverity;
  basis: FindingBasis;
  affectedUrl: string;
}

export interface ProposalOpportunity {
  id: string;
  source: OpportunitySource;
  ref: string;
  title: string;
  summary: string;
  origin: ContentOrigin;
  category: FindingCategory | null;
  severity: FindingSeverity;
  /** Finding IDs from the source audit. Always non-empty. */
  findingIds: string[];
  evidence: EvidenceReference[];
  /** For AI-sourced items: the `startedAt` of the interpretation they were selected from. */
  interpretationStartedAt?: string;
}

export interface ProposalText {
  text: string;
  origin: ContentOrigin;
}

export interface ProposalObjective extends ProposalText {
  id: string;
}

export interface ProposalDeliverable {
  id: string;
  title: string;
  description: string;
  origin: ContentOrigin;
  /** Proposal opportunity IDs this deliverable addresses. */
  opportunityIds: string[];
}

export interface ProposalMilestone {
  id: string;
  title: string;
  description: string;
  /** Free-text duration such as "2 weeks". AI-suggested durations are estimates only. */
  duration: string;
  /** ISO date (YYYY-MM-DD) or null. */
  targetDate: string | null;
  origin: ContentOrigin;
}

/** Pricing is always user-entered; ScopePilot never generates prices. */
export interface PricingLineItem {
  id: string;
  label: string;
  /** Null until the user enters an amount. */
  amount: number | null;
}

export interface ProposalPricing {
  /** ISO 4217 code, e.g. "USD". */
  currency: string;
  lineItems: PricingLineItem[];
  paymentTerms: string;
}

export interface ProposalClient {
  businessName: string;
  contactName: string;
  contactEmail: string;
  website: string;
}

/** The user-editable part of a proposal. */
export interface ProposalContent {
  title: string;
  client: ProposalClient;
  overview: ProposalText;
  objectives: ProposalObjective[];
  scope: ProposalText;
  deliverables: ProposalDeliverable[];
  milestones: ProposalMilestone[];
  pricing: ProposalPricing;
  terms: ProposalText;
}

export interface Proposal extends ProposalContent {
  id: string;
  auditId: string;
  auditUrl: string;
  status: ProposalStatus;
  /** Incremented on every save; updates must send the revision they edited. */
  revision: number;
  opportunities: ProposalOpportunity[];
  createdAt: string;
  updatedAt: string;
}

export interface ProposalSummary {
  id: string;
  auditId: string;
  title: string;
  businessName: string;
  status: ProposalStatus;
  opportunityCount: number;
  currency: string;
  /** Sum of entered line items, or null when no amounts are entered. */
  total: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProposalInput {
  auditId: string;
  selections: OpportunitySelection[];
  title?: string;
  client?: Partial<ProposalClient>;
}

export interface UpdateProposalInput {
  revision: number;
  status: ProposalStatus;
  content: ProposalContent;
  /** Existing opportunity IDs to keep, in display order. Omitted IDs are removed. */
  opportunityIds: string[];
  /** New selections from the source audit to add. */
  addSelections: OpportunitySelection[];
}

export interface ProposalResponse {
  proposal: Proposal;
  /** Whether AI drafting is configured server-side. Never exposes the key. */
  aiDraftConfigured: boolean;
}

export interface ProposalConflictResponse {
  error: "PROPOSAL_CONFLICT";
  message: string;
  current: Proposal;
}

export interface ProposalListResponse {
  proposals: ProposalSummary[];
}

// AI drafting. Suggestions are returned to the editor and only persisted if the user saves them.

export interface AiProposalDraft {
  overview: string;
  objectives: string[];
  scope: string;
  deliverables: Array<{ title: string; description: string; opportunityIds: string[] }>;
  milestones: Array<{ title: string; description: string; duration: string }>;
}

export interface ProposalDraftResponse {
  status: "completed" | "partial";
  model: string;
  draft: AiProposalDraft;
  rejected: InterpretationRejection[];
}

// Limits and validation.

export const PROPOSAL_LIMITS = {
  title: 160,
  shortText: 200,
  longText: 4_000,
  itemDescription: 1_200,
  maxObjectives: 20,
  maxDeliverables: 30,
  maxMilestones: 30,
  maxLineItems: 30,
  maxOpportunities: 60,
  maxAmount: 100_000_000,
  itemId: 64,
} as const;

export const DEFAULT_PAYMENT_TERMS = "";
export const DEFAULT_CURRENCY = "USD";

const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Finding IDs join rule IDs and full URLs with "|", so any printable text is allowed. */
// eslint-disable-next-line no-control-regex
const FINDING_REF = /^[^\u0000-\u001f\u007f]{1,2048}$/;
/** Room for `ai-issue:I1@<timestamp>` or `finding:<finding id>`. */
const OPPORTUNITY_ID_MAX = 2_100;
const AI_ISSUE_REF = /^I\d{1,3}$/;
const AI_OPPORTUNITY_REF = /^O\d{1,2}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const ORIGINS: readonly ContentOrigin[] = ["user", "rule-based", "ai-suggestion"];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

class InputError extends Error {}

function fail(message: string): never {
  throw new InputError(message);
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function arr(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  if (value.length > max) fail(`${path} may contain at most ${max} items.`);
  return value;
}

/** Trims; allows empty strings unless `required`. */
function str(value: unknown, path: string, max: number, required = false): string {
  if (typeof value !== "string") fail(`${path} must be a string.`);
  const trimmed = value.trim();
  if (required && trimmed.length === 0) fail(`${path} is required.`);
  if (trimmed.length > max) fail(`${path} must be at most ${max} characters.`);
  return trimmed;
}

function itemId(value: unknown, path: string, seen: Set<string>): string {
  if (typeof value !== "string" || !ITEM_ID.test(value)) fail(`${path} must be a short identifier.`);
  if (seen.has(value)) fail(`${path} duplicates another item identifier.`);
  seen.add(value);
  return value;
}

function origin(value: unknown, path: string, allowed: readonly ContentOrigin[] = ORIGINS): ContentOrigin {
  if (typeof value !== "string" || !allowed.includes(value as ContentOrigin)) fail(`${path} must be one of ${allowed.join(", ")}.`);
  return value as ContentOrigin;
}

function websiteUrl(value: unknown, path: string): string {
  const text = str(value, path, 500);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") fail(`${path} must be an http(s) URL.`);
    return url.toString();
  } catch (error) {
    if (error instanceof InputError) throw error;
    fail(`${path} must be a valid URL.`);
  }
}

function proposalText(value: unknown, path: string, max: number): ProposalText {
  const record = obj(value, path);
  return { text: str(record.text, `${path}.text`, max), origin: origin(record.origin, `${path}.origin`) };
}

function isoDate(value: unknown, path: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !ISO_DATE.test(value)) fail(`${path} must be a YYYY-MM-DD date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${path} is not a valid date.`);
  return value;
}

function amount(value: unknown, path: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a number.`);
  if (value < 0 || value > PROPOSAL_LIMITS.maxAmount) fail(`${path} must be between 0 and ${PROPOSAL_LIMITS.maxAmount}.`);
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) fail(`${path} may have at most two decimal places.`);
  return Math.round(value * 100) / 100;
}

function client(value: unknown, path: string, partial: boolean): ProposalClient {
  const record = value === undefined && partial ? {} : obj(value, path);
  const field = (key: keyof ProposalClient, max: number) => (record[key] === undefined && partial ? "" : str(record[key], `${path}.${key}`, max));
  const contactEmail = field("contactEmail", 254);
  if (contactEmail && !EMAIL.test(contactEmail)) fail(`${path}.contactEmail must be a valid email address.`);
  return {
    businessName: field("businessName", PROPOSAL_LIMITS.shortText),
    contactName: field("contactName", PROPOSAL_LIMITS.shortText),
    contactEmail,
    website: record.website === undefined && partial ? "" : websiteUrl(record.website, `${path}.website`),
  };
}

function selections(value: unknown, path: string): OpportunitySelection[] {
  const seen = new Set<string>();
  return arr(value, path, PROPOSAL_LIMITS.maxOpportunities).map((item, index) => {
    const record = obj(item, `${path}[${index}]`);
    const source = record.source;
    const ref = record.ref;
    if (source !== "finding" && source !== "ai-issue" && source !== "ai-opportunity") fail(`${path}[${index}].source must be finding, ai-issue or ai-opportunity.`);
    const pattern = source === "finding" ? FINDING_REF : source === "ai-issue" ? AI_ISSUE_REF : AI_OPPORTUNITY_REF;
    if (typeof ref !== "string" || !pattern.test(ref)) fail(`${path}[${index}].ref is not a valid ${source} reference.`);
    const key = `${source}:${ref}`;
    if (seen.has(key)) fail(`${path}[${index}] is selected more than once.`);
    seen.add(key);
    return { source, ref };
  });
}

function guard<T>(parse: () => T): ParseResult<T> {
  try { return { ok: true, value: parse() }; }
  catch (error) {
    if (error instanceof InputError) return { ok: false, error: error.message };
    throw error;
  }
}

export function parseCreateProposalInput(value: unknown): ParseResult<CreateProposalInput> {
  return guard(() => {
    const body = obj(value, "body");
    if (typeof body.auditId !== "string" || !/^[a-f0-9]{24}$/i.test(body.auditId)) fail("auditId must be a valid audit identifier.");
    const picked = selections(body.selections, "selections");
    if (picked.length === 0) fail("Select at least one opportunity from the audit.");
    const title = body.title === undefined ? undefined : str(body.title, "title", PROPOSAL_LIMITS.title);
    return { auditId: body.auditId.toLowerCase(), selections: picked, ...(title ? { title } : {}), ...(body.client === undefined ? {} : { client: client(body.client, "client", true) }) };
  });
}

export function parseProposalContent(value: unknown, path = "content"): ProposalContent {
  const record = obj(value, path);
  const L = PROPOSAL_LIMITS;
  const ids = new Set<string>();
  const pricing = obj(record.pricing, `${path}.pricing`);
  const currency = typeof pricing.currency === "string" ? pricing.currency.trim().toUpperCase() : "";
  if (!CURRENCY_CODE.test(currency)) fail(`${path}.pricing.currency must be a three-letter currency code.`);
  return {
    title: str(record.title, `${path}.title`, L.title, true),
    client: client(record.client, `${path}.client`, false),
    overview: proposalText(record.overview, `${path}.overview`, L.longText),
    objectives: arr(record.objectives, `${path}.objectives`, L.maxObjectives).map((item, index) => {
      const p = `${path}.objectives[${index}]`;
      const objective = obj(item, p);
      return { id: itemId(objective.id, `${p}.id`, ids), text: str(objective.text, `${p}.text`, L.itemDescription), origin: origin(objective.origin, `${p}.origin`) };
    }),
    scope: proposalText(record.scope, `${path}.scope`, L.longText),
    deliverables: arr(record.deliverables, `${path}.deliverables`, L.maxDeliverables).map((item, index) => {
      const p = `${path}.deliverables[${index}]`;
      const deliverable = obj(item, p);
      const linked = arr(deliverable.opportunityIds, `${p}.opportunityIds`, L.maxOpportunities).map((id, i) => str(id, `${p}.opportunityIds[${i}]`, OPPORTUNITY_ID_MAX, true));
      return { id: itemId(deliverable.id, `${p}.id`, ids), title: str(deliverable.title, `${p}.title`, L.shortText), description: str(deliverable.description, `${p}.description`, L.itemDescription), origin: origin(deliverable.origin, `${p}.origin`), opportunityIds: [...new Set(linked)] };
    }),
    milestones: arr(record.milestones, `${path}.milestones`, L.maxMilestones).map((item, index) => {
      const p = `${path}.milestones[${index}]`;
      const milestone = obj(item, p);
      return { id: itemId(milestone.id, `${p}.id`, ids), title: str(milestone.title, `${p}.title`, L.shortText), description: str(milestone.description, `${p}.description`, L.itemDescription), duration: str(milestone.duration, `${p}.duration`, 80), targetDate: isoDate(milestone.targetDate, `${p}.targetDate`), origin: origin(milestone.origin, `${p}.origin`) };
    }),
    pricing: {
      currency,
      lineItems: arr(pricing.lineItems, `${path}.pricing.lineItems`, L.maxLineItems).map((item, index) => {
        const p = `${path}.pricing.lineItems[${index}]`;
        const line = obj(item, p);
        return { id: itemId(line.id, `${p}.id`, ids), label: str(line.label, `${p}.label`, L.shortText), amount: amount(line.amount, `${p}.amount`) };
      }),
      paymentTerms: str(pricing.paymentTerms, `${path}.pricing.paymentTerms`, L.longText),
    },
    terms: proposalText(record.terms, `${path}.terms`, L.longText),
  };
}

export function parseUpdateProposalInput(value: unknown): ParseResult<UpdateProposalInput> {
  return guard(() => {
    const body = obj(value, "body");
    if (typeof body.revision !== "number" || !Number.isInteger(body.revision) || body.revision < 1) fail("revision must be a positive integer.");
    if (typeof body.status !== "string" || !PROPOSAL_STATUSES.includes(body.status as ProposalStatus)) fail(`status must be one of ${PROPOSAL_STATUSES.join(", ")}.`);
    const opportunityIds = arr(body.opportunityIds, "opportunityIds", PROPOSAL_LIMITS.maxOpportunities).map((id, index) => str(id, `opportunityIds[${index}]`, OPPORTUNITY_ID_MAX, true));
    if (new Set(opportunityIds).size !== opportunityIds.length) fail("opportunityIds contains duplicates.");
    return {
      revision: body.revision,
      status: body.status as ProposalStatus,
      content: parseProposalContent(body.content),
      opportunityIds,
      addSelections: body.addSelections === undefined ? [] : selections(body.addSelections, "addSelections"),
    };
  });
}

// Totals.

/** Sums entered amounts in cents to avoid floating-point drift. Null when nothing is entered. */
export function proposalTotal(pricing: Pick<ProposalPricing, "lineItems">): number | null {
  const entered = pricing.lineItems.filter((line) => line.amount !== null);
  if (entered.length === 0) return null;
  return entered.reduce((cents, line) => cents + Math.round((line.amount ?? 0) * 100), 0) / 100;
}

// Opportunity resolution against the source audit.

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function opportunityId(selection: OpportunitySelection, interpretationStartedAt?: string): string {
  const base = `${selection.source}:${selection.ref}`;
  return selection.source === "finding" || !interpretationStartedAt ? base : `${base}@${interpretationStartedAt}`;
}

export function evidenceReference(finding: AuditFinding): EvidenceReference {
  return { findingId: finding.id, title: finding.title, category: finding.category, severity: finding.severity, basis: finding.basis, affectedUrl: finding.affectedUrl };
}

export interface InterpretationSnapshot {
  startedAt: string;
  content: InterpretationContent | null;
}

export type ResolveResult = { ok: true; opportunities: ProposalOpportunity[] } | { ok: false; error: string; ref: string };

/**
 * Turns selections into opportunity snapshots. Every opportunity must map to findings that exist in
 * the audit; AI items whose finding IDs are not all present are refused rather than trimmed.
 */
export function resolveSelections(picked: OpportunitySelection[], findings: AuditFinding[], interpretation: InterpretationSnapshot | null): ResolveResult {
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const opportunities: ProposalOpportunity[] = [];
  for (const selection of picked) {
    const label = `${selection.source}:${selection.ref}`;
    if (selection.source === "finding") {
      const finding = byId.get(selection.ref);
      if (!finding) return { ok: false, error: `Finding ${selection.ref} does not exist in this audit.`, ref: label };
      opportunities.push({ id: opportunityId(selection), source: "finding", ref: finding.id, title: finding.title, summary: finding.remediation, origin: "rule-based", category: finding.category, severity: finding.severity, findingIds: [finding.id], evidence: [evidenceReference(finding)] });
      continue;
    }
    const content = interpretation?.content;
    if (!interpretation || !content) return { ok: false, error: "This audit has no AI interpretation to select from.", ref: label };
    let title: string;
    let summary: string;
    let findingIds: string[];
    if (selection.source === "ai-issue") {
      const issue = content.issues.find((item) => item.ref === selection.ref);
      if (!issue) return { ok: false, error: `AI issue ${selection.ref} is not part of the current interpretation.`, ref: label };
      ({ title } = issue);
      summary = issue.plainLanguage;
      findingIds = issue.findingIds;
    } else {
      const opportunity = content.opportunities[Number(selection.ref.slice(1))];
      if (!opportunity) return { ok: false, error: `AI opportunity ${selection.ref} is not part of the current interpretation.`, ref: label };
      ({ title, summary, findingIds } = opportunity);
    }
    const supporting = findingIds.map((id) => byId.get(id));
    if (findingIds.length === 0 || supporting.some((finding) => !finding)) return { ok: false, error: `${label} references findings that are not in this audit.`, ref: label };
    const evidence = (supporting as AuditFinding[]).map(evidenceReference);
    const categories = new Set(evidence.map((item) => item.category));
    const severity = evidence.reduce<FindingSeverity>((worst, item) => (SEVERITY_RANK[item.severity] < SEVERITY_RANK[worst] ? item.severity : worst), "info");
    opportunities.push({
      id: opportunityId(selection, interpretation.startedAt),
      source: selection.source,
      ref: selection.ref,
      title,
      summary,
      origin: "ai-suggestion",
      category: categories.size === 1 ? [...categories][0]! : null,
      severity,
      findingIds: [...findingIds],
      evidence,
      interpretationStartedAt: interpretation.startedAt,
    });
  }
  return { ok: true, opportunities };
}

/** Initial editable content for a new proposal. Deliverables are seeded from the selections. */
export function initialProposalContent(input: { title?: string; client?: Partial<ProposalClient>; auditUrl: string; opportunities: ProposalOpportunity[]; newId: () => string }): ProposalContent {
  let host = input.auditUrl;
  try { host = new URL(input.auditUrl).hostname; } catch { /* keep raw */ }
  return {
    title: input.title || `Website improvement proposal — ${host}`,
    client: { businessName: input.client?.businessName ?? "", contactName: input.client?.contactName ?? "", contactEmail: input.client?.contactEmail ?? "", website: input.client?.website || input.auditUrl },
    overview: { text: "", origin: "user" },
    objectives: [],
    scope: { text: "", origin: "user" },
    deliverables: input.opportunities.map((opportunity) => ({ id: input.newId(), title: opportunity.title, description: opportunity.summary, origin: opportunity.origin, opportunityIds: [opportunity.id] })),
    milestones: [],
    pricing: { currency: DEFAULT_CURRENCY, lineItems: [], paymentTerms: DEFAULT_PAYMENT_TERMS },
    terms: { text: "", origin: "user" },
  };
}

// Structural validation of raw AI draft output.

export const DRAFT_LIMITS = { overview: 1_500, scope: 1_500, objective: 300, maxObjectives: 6, title: 120, description: 600, maxDeliverables: 12, maxMilestones: 8, duration: 40 } as const;

export type DraftParseResult = { ok: true; value: AiProposalDraft; rejected: InterpretationRejection[] } | { ok: false; reason: string };

function draftText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** Validates AI draft shape. Malformed list items are dropped and reported. */
export function parseAiProposalDraft(value: unknown, knownOpportunityIds: ReadonlySet<string>): DraftParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "AI draft must be a JSON object." };
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.objectives) || !Array.isArray(root.deliverables) || !Array.isArray(root.milestones)) return { ok: false, reason: "AI draft is missing objectives, deliverables or milestones." };
  const L = DRAFT_LIMITS;
  const rejected: InterpretationRejection[] = [];
  const overview = draftText(root.overview, L.overview);
  if (!overview) rejected.push({ path: "overview", reason: "Overview is missing, empty or too long." });
  const scope = draftText(root.scope, L.scope);
  if (!scope) rejected.push({ path: "scope", reason: "Scope is missing, empty or too long." });

  const objectives: string[] = [];
  root.objectives.slice(0, L.maxObjectives).forEach((item, index) => {
    const objective = draftText(item, L.objective);
    if (objective) objectives.push(objective);
    else rejected.push({ path: `objectives[${index}]`, reason: "Objective is empty or too long." });
  });

  const deliverables: AiProposalDraft["deliverables"] = [];
  root.deliverables.slice(0, L.maxDeliverables).forEach((item, index) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const title = draftText(record.title, L.title);
    const description = draftText(record.description, L.description);
    const ids = Array.isArray(record.opportunityIds) ? record.opportunityIds.filter((id): id is string => typeof id === "string") : [];
    if (!title || !description || ids.length === 0) {
      rejected.push({ path: `deliverables[${index}]`, reason: "Deliverable is missing a title, description or linked opportunity." });
      return;
    }
    const unknown = ids.filter((id) => !knownOpportunityIds.has(id));
    if (unknown.length > 0) {
      rejected.push({ path: `deliverables[${index}]`, reason: `Deliverable references opportunities that were not supplied (${unknown.join(", ")}).` });
      return;
    }
    deliverables.push({ title, description, opportunityIds: [...new Set(ids)] });
  });

  const milestones: AiProposalDraft["milestones"] = [];
  root.milestones.slice(0, L.maxMilestones).forEach((item, index) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const title = draftText(record.title, L.title);
    const description = draftText(record.description, L.description);
    const duration = draftText(record.duration, L.duration);
    if (!title || !description || !duration) {
      rejected.push({ path: `milestones[${index}]`, reason: "Milestone is missing a title, description or duration." });
      return;
    }
    milestones.push({ title, description, duration });
  });

  return { ok: true, value: { overview: overview ?? "", objectives, scope: scope ?? "", deliverables, milestones }, rejected };
}
