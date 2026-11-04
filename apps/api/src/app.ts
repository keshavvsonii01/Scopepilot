import type { AuditAnalysis } from "@scopepilot/contracts/analysis";
import type { AuditStatusResponse, AuditSummary, CreateAuditInput } from "@scopepilot/contracts/audit";
import type { AuditInterpretation, InterpretationProvider, InterpretationResponse } from "@scopepilot/contracts/interpretation";
import { UnsafeUrlError, validateCrawlTarget } from "@scopepilot/crawl-core/security";
import type { DraftOutcome, InterpretationOutcome } from "@scopepilot/intelligence";
import {
  initialProposalContent,
  parseCreateProposalInput,
  parseUpdateProposalInput,
  PROPOSAL_LIMITS,
  resolveSelections,
  type OpportunitySelection,
  type Proposal,
  type ProposalClient,
  type ProposalConflictResponse,
  type ProposalDraftResponse,
  type ProposalListResponse,
  type ProposalOpportunity,
  type ProposalResponse,
  type ProposalSummary,
} from "@scopepilot/contracts/proposal";
import type { AuditFinding } from "@scopepilot/contracts/analysis";
import type { NewProposal, ProposalChanges, ProposalUpdateResult } from "@scopepilot/persistence/proposals";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import { parseLoginInput, parseRegisterInput, REGISTER_ACCEPTED_MESSAGE, type AccountResponse, type RegisterResponse, type SessionResponse } from "@scopepilot/contracts/auth";
import { createHash, timingSafeEqual } from "node:crypto";
import { renderProposalPdf, proposalPdfFilename } from "./proposal-pdf.js";
import { readCookie, tokensMatch, toSessionResponse, type AuthContext, type AuthService } from "./auth.js";
import * as persistence from "./store.js";

export interface AuditStore {
  createAudit(submission: CreateAuditInput & { workspaceId: string }): Promise<AuditStatusResponse>;
  getAuditForWorkspace(id: string, workspaceId: string): Promise<AuditStatusResponse | null>;
  listAuditsForWorkspace(workspaceId: string): Promise<AuditSummary[]>;
  getInterpretationForWorkspace(auditId: string, workspaceId: string): Promise<AuditInterpretation | null>;
  beginInterpretation(attempt: { auditId: string; workspaceId: string; provider: InterpretationProvider; model: string; promptVersion: string }): Promise<string | null>;
  completeInterpretation(auditId: string, attemptId: string, outcome: InterpretationOutcome): Promise<AuditInterpretation | null>;
}

/** Server-side AI interpreter. Null when no provider key is configured. */
export interface Interpreter {
  provider: InterpretationProvider;
  model: string;
  promptVersion: string;
  interpret(input: { analysis: AuditAnalysis; rootUrl: string }): Promise<InterpretationOutcome>;
}

export interface ProposalStore {
  createProposal(proposal: NewProposal): Promise<Proposal>;
  getProposalForWorkspace(id: string, workspaceId: string): Promise<Proposal | null>;
  listProposalsForWorkspace(workspaceId: string, auditId?: string): Promise<ProposalSummary[]>;
  updateProposal(changes: ProposalChanges): Promise<ProposalUpdateResult>;
}

/** Server-side AI proposal drafter. Null when no provider key is configured. */
export interface Drafter {
  model: string;
  draft(input: { auditUrl: string; client: ProposalClient; opportunities: ProposalOpportunity[]; findings: AuditFinding[] }): Promise<DraftOutcome>;
}

export interface ApiDependencies {
  /** Session authentication. Every protected route resolves session → user → workspace membership through it. */
  auth: AuthService;
  /**
   * Express `trust proxy` setting. Only proxies listed here may supply X-Forwarded-For, which rate
   * limits use as the client address. Defaults to loopback (the local Next.js server).
   */
  trustProxy?: boolean | string | number;
  /**
   * Shared secret the web proxy sends on every request. When set, requests without it get 404, and rate
   * limits key on the client address the proxy reports instead of X-Forwarded-For. Required when the
   * API has a public URL, because the API cannot otherwise tell the web proxy apart from direct callers.
   */
  proxySecret?: string | null;
  /** Rate-limit overrides (requests per window). Tests use these; production uses the defaults. */
  authLimits?: Partial<AuthLimits>;
  store?: AuditStore;
  proposals?: ProposalStore;
  interpreter?: Interpreter | null;
  drafter?: Drafter | null;
  validateTarget?: (url: string) => Promise<URL>;
}

export interface AuthLimits {
  /** Registrations per IP per hour. */
  registerPerIp: number;
  /** Login attempts per IP per 15 minutes. */
  loginPerIp: number;
  /** Failed login attempts per email address per 15 minutes (brute-force protection, applies to unknown emails too). */
  loginFailuresPerEmail: number;
}

const DEFAULT_AUTH_LIMITS: AuthLimits = { registerPerIp: 10, loginPerIp: 30, loginFailuresPerEmail: 10 };
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const AUDIT_ID = /^[a-f0-9]{24}$/i;
const PROPOSAL_ID = /^[a-f0-9]{24}$/i;

/** HTTP status for AI provider failures surfaced by the drafting endpoint. */
function draftFailureStatus(code: string): number {
  if (code === "AI_RATE_LIMITED") return 429;
  if (code === "AI_TIMEOUT") return 504;
  if (code === "AI_INVALID_OUTPUT" || code === "NO_FINDINGS") return 422;
  return 502;
}

function parseSubmission(value: unknown): { input?: CreateAuditInput; error?: string } {
  if (!value || typeof value !== "object") return { error: "A JSON object is required." };
  const body = value as Record<string, unknown>;
  if (typeof body.url !== "string") return { error: "url must be a string." };
  if (body.mode !== "quick" && body.mode !== "standard") return { error: "mode must be quick or standard." };
  if (typeof body.includeMobileChecks !== "boolean" || typeof body.includeAccessibilityChecks !== "boolean") return { error: "Check options must be boolean values." };
  return { input: { url: body.url.trim(), mode: body.mode, includeMobileChecks: body.includeMobileChecks, includeAccessibilityChecks: body.includeAccessibilityChecks } };
}

export const PROXY_SECRET_HEADER = "x-scopepilot-proxy-secret";
export const PROXY_CLIENT_HEADER = "x-scopepilot-client-ip";
const CLIENT_IP = /^[0-9a-fA-F:.]{2,45}$/;

/** Rate-limit key: the client address vouched for by the authenticated web proxy, else Express's `req.ip`. */
function clientKey(request: Request, response: Response): string {
  return ipKeyGenerator((response.locals.proxiedClientIp as string | undefined) ?? request.ip ?? "");
}

function limiter(limit: number, message: string) {
  return rateLimit({ windowMs: 15 * 60_000, limit, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: clientKey, message: { error: "RATE_LIMITED", message } });
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function storeUnavailable(response: Response) {
  return response.status(503).json({ error: "STORE_UNAVAILABLE", message: "Audit storage is temporarily unavailable." });
}

function notFound(response: Response) {
  return response.status(404).json({ error: "AUDIT_NOT_FOUND", message: "No audit exists in this workspace." });
}

function proposalNotFound(response: Response) {
  return response.status(404).json({ error: "PROPOSAL_NOT_FOUND", message: "No proposal exists in this workspace." });
}

function auditFindings(audit: AuditStatusResponse): AuditFinding[] | null {
  if (audit.status !== "completed" && audit.status !== "partial") return null;
  return audit.result?.analysis?.findings ?? null;
}

function auditUrl(audit: AuditStatusResponse): string {
  return audit.result?.pages[0]?.url ?? "";
}

function needsInterpretation(selections: OpportunitySelection[]): boolean {
  return selections.some((selection) => selection.source !== "finding");
}

export function createApi(dependencies: ApiDependencies) {
  const auth = dependencies.auth;
  const authLimits: AuthLimits = { ...DEFAULT_AUTH_LIMITS, ...dependencies.authLimits };
  const store: AuditStore = dependencies.store ?? persistence;
  const proposals: ProposalStore = dependencies.proposals ?? persistence;
  const interpreter = dependencies.interpreter ?? null;
  const drafter = dependencies.drafter ?? null;
  const validateTarget = dependencies.validateTarget ?? validateCrawlTarget;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", dependencies.trustProxy ?? "loopback");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-origin" } }));
  const proxySecretDigest = dependencies.proxySecret ? sha256(dependencies.proxySecret) : null;
  if (proxySecretDigest) {
    app.use((request, response, next) => {
      if (!timingSafeEqual(sha256(request.get(PROXY_SECRET_HEADER) ?? ""), proxySecretDigest)) return response.status(404).json({ error: "NOT_FOUND", message: "Not found." });
      const client = request.get(PROXY_CLIENT_HEADER)?.trim();
      if (client && CLIENT_IP.test(client)) response.locals.proxiedClientIp = client;
      next();
    });
  }
  // Authenticated and account responses must never be cached by browsers or intermediaries.
  app.use("/v1", (_request, response, next) => { response.set("cache-control", "no-store"); next(); });
  // Proposal documents are larger than audit submissions; the default body limit stays small elsewhere.
  app.use("/v1/proposals", express.json({ limit: "256kb", type: "application/json" }));
  app.use(express.json({ limit: "16kb", type: "application/json" }));

  // Submissions and AI calls are expensive; reads are cheap and polled by the report page.
  const submitLimit = limiter(10, "Too many audit requests. Try again later.");
  const readLimit = limiter(600, "Too many requests. Try again later.");
  const interpretLimit = limiter(10, "Too many AI interpretation requests. Try again later.");
  const proposalWriteLimit = limiter(300, "Too many proposal changes. Try again later.");
  const draftLimit = limiter(10, "Too many AI drafting requests. Try again later.");
  // PDF rendering is CPU-bound; keep exports well below the read limit.
  const pdfLimit = limiter(60, "Too many PDF exports. Try again later.");
  const registerLimit = rateLimit({ windowMs: 60 * 60_000, limit: authLimits.registerPerIp, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: clientKey, message: { error: "RATE_LIMITED", message: "Too many sign-up attempts. Try again later." } });
  const loginIpLimit = limiter(authLimits.loginPerIp, "Too many sign-in attempts. Try again later.");
  // Keyed by a hash of the submitted email whether or not the account exists, so the limit itself reveals nothing.
  const loginEmailLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: authLimits.loginFailuresPerEmail,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (request) => `email:${createHash("sha256").update(typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "").digest("hex")}`,
    message: { error: "RATE_LIMITED", message: "Too many sign-in attempts. Try again later." },
  });

  const sessionToken = (request: Request) => readCookie(request.get("cookie"), auth.cookieName);
  const cookieOptions = { httpOnly: true, secure: auth.policy.secureCookie, sameSite: "lax", path: "/" } as const;
  const setSessionCookie = (response: Response, token: string) => response.cookie(auth.cookieName, token, { ...cookieOptions, maxAge: auth.policy.ttlMs });
  const clearSessionCookie = (response: Response) => response.clearCookie(auth.cookieName, cookieOptions);
  const authRequired = (response: Response) => response.status(401).json({ error: "AUTH_REQUIRED", message: "Sign in to continue." });

  /**
   * Resolves the authenticated session, its user and their workspace membership. The workspace comes
   * only from the server-side session — never from the request. Writes also require the per-session
   * CSRF token.
   */
  async function requireWorkspace(request: Request, response: Response, next: NextFunction) {
    const token = sessionToken(request);
    let context: AuthContext | null;
    try { context = await auth.authenticate(token); }
    catch { return response.status(503).json({ error: "AUTH_UNAVAILABLE", message: "Sign-in is temporarily unavailable." }); }
    if (!context) {
      if (token) clearSessionCookie(response);
      return authRequired(response);
    }
    if (!SAFE_METHODS.has(request.method) && !tokensMatch(request.get("x-csrf-token"), context.csrfToken)) {
      return response.status(403).json({ error: "CSRF_INVALID", message: "This request could not be verified. Refresh the page and try again." });
    }
    response.locals.auth = context;
    response.locals.workspaceId = context.workspace.id;
    return next();
  }

  // Same status and body whether the email is new or already registered (no enumeration); no session is issued.
  app.post("/v1/auth/register", registerLimit, async (request, response) => {
    const parsed = parseRegisterInput(request.body);
    if (!parsed.ok) return response.status(400).json({ error: "INVALID_REGISTRATION", field: parsed.field, message: parsed.error });
    try {
      await auth.register(parsed.value);
      const body: RegisterResponse = { status: "accepted", message: REGISTER_ACCEPTED_MESSAGE };
      return response.status(202).json(body);
    } catch { return response.status(503).json({ error: "AUTH_UNAVAILABLE", message: "Sign-up is temporarily unavailable." }); }
  });

  app.post("/v1/auth/login", loginIpLimit, loginEmailLimit, async (request, response) => {
    const parsed = parseLoginInput(request.body);
    if (!parsed.ok) return response.status(400).json({ error: "INVALID_LOGIN", field: parsed.field, message: parsed.error });
    try {
      const session = await auth.login(parsed.value, sessionToken(request));
      if (!session) return response.status(401).json({ error: "INVALID_CREDENTIALS", message: "Email or password is incorrect." });
      setSessionCookie(response, session.token);
      const body: SessionResponse = session.response;
      return response.status(200).json(body);
    } catch { return response.status(503).json({ error: "AUTH_UNAVAILABLE", message: "Sign-in is temporarily unavailable." }); }
  });

  app.post("/v1/auth/logout", readLimit, async (request, response) => {
    const token = sessionToken(request);
    try {
      const context = await auth.authenticate(token);
      // A valid session can only be ended by the page that holds its CSRF token; stale cookies are simply cleared.
      if (context && !tokensMatch(request.get("x-csrf-token"), context.csrfToken)) return response.status(403).json({ error: "CSRF_INVALID", message: "This request could not be verified. Refresh the page and try again." });
      await auth.logout(token);
    } catch { return response.status(503).json({ error: "AUTH_UNAVAILABLE", message: "Sign-out is temporarily unavailable." }); }
    clearSessionCookie(response);
    return response.status(204).end();
  });

  app.get("/v1/auth/session", readLimit, requireWorkspace, (_request, response) => {
    const body: SessionResponse = toSessionResponse(response.locals.auth as AuthContext);
    return response.status(200).json(body);
  });

  app.get("/v1/account", readLimit, requireWorkspace, (_request, response) => {
    const context = response.locals.auth as AuthContext;
    const body: AccountResponse = { user: context.user, workspace: context.workspace };
    return response.status(200).json(body);
  });

  function requireAuditId(request: Request, response: Response, next: NextFunction) {
    if (!AUDIT_ID.test(String(request.params.auditId))) return response.status(400).json({ error: "INVALID_AUDIT_ID", message: "The audit identifier is invalid." });
    return next();
  }

  function requireProposalId(request: Request, response: Response, next: NextFunction) {
    if (!PROPOSAL_ID.test(String(request.params.proposalId))) return response.status(400).json({ error: "INVALID_PROPOSAL_ID", message: "The proposal identifier is invalid." });
    return next();
  }

  /** Loads the audit findings (and interpretation when AI items are selected) and resolves selections. */
  async function resolveForAudit(audit: AuditStatusResponse, selections: OpportunitySelection[], workspaceId: string) {
    const findings = auditFindings(audit);
    if (!findings) return { ok: false, status: 409, body: { error: "AUDIT_NOT_READY", message: "Proposals can be created once the audit has finished with analysis results." } } as const;
    const interpretation = needsInterpretation(selections) ? await store.getInterpretationForWorkspace(audit.id, workspaceId) : null;
    const resolved = resolveSelections(selections, findings, interpretation && interpretation.content ? { startedAt: interpretation.startedAt, content: interpretation.content } : null);
    if (!resolved.ok) return { ok: false, status: 422, body: { error: "INVALID_SELECTION", message: resolved.error, ref: resolved.ref } } as const;
    return { ok: true, opportunities: resolved.opportunities } as const;
  }

  app.post("/v1/audits", submitLimit, requireWorkspace, async (request, response) => {
    const parsed = parseSubmission(request.body);
    if (!parsed.input) return response.status(400).json({ error: "INVALID_SUBMISSION", message: parsed.error });
    let target: URL;
    try { target = await validateTarget(parsed.input.url); }
    catch (error) {
      if (error instanceof UnsafeUrlError) return response.status(400).json({ error: error.code, message: error.message });
      return response.status(503).json({ error: "TARGET_VALIDATION_UNAVAILABLE", message: "The target could not be safely validated at this time." });
    }
    try { return response.status(202).json(await store.createAudit({ ...parsed.input, url: target.toString(), workspaceId: response.locals.workspaceId })); }
    catch { return storeUnavailable(response); }
  });

  app.get("/v1/audits", readLimit, requireWorkspace, async (_request, response) => {
    try { return response.status(200).json({ audits: await store.listAuditsForWorkspace(response.locals.workspaceId) }); }
    catch { return storeUnavailable(response); }
  });

  app.get("/v1/audits/:auditId", readLimit, requireWorkspace, requireAuditId, async (request, response) => {
    try {
      const audit = await store.getAuditForWorkspace(String(request.params.auditId), response.locals.workspaceId);
      return audit ? response.status(200).json(audit) : notFound(response);
    } catch { return storeUnavailable(response); }
  });

  app.get("/v1/audits/:auditId/interpretation", readLimit, requireWorkspace, requireAuditId, async (request, response) => {
    const id = String(request.params.auditId);
    try {
      if (!(await store.getAuditForWorkspace(id, response.locals.workspaceId))) return notFound(response);
      const body: InterpretationResponse = { configured: interpreter !== null, interpretation: await store.getInterpretationForWorkspace(id, response.locals.workspaceId) };
      return response.status(200).json(body);
    } catch { return storeUnavailable(response); }
  });

  app.post("/v1/audits/:auditId/interpretation", interpretLimit, requireWorkspace, requireAuditId, async (request, response) => {
    const id = String(request.params.auditId);
    const workspaceId: string = response.locals.workspaceId;
    let audit: AuditStatusResponse | null;
    try { audit = await store.getAuditForWorkspace(id, workspaceId); }
    catch { return storeUnavailable(response); }
    if (!audit) return notFound(response);
    if (audit.status !== "completed" && audit.status !== "partial") return response.status(409).json({ error: "AUDIT_NOT_READY", message: "AI interpretation is available once the audit has finished with results." });
    const analysis = audit.result?.analysis;
    if (!analysis) return response.status(422).json({ error: "ANALYSIS_UNAVAILABLE", message: "This audit has no analysis results to interpret." });
    if (analysis.findings.length === 0) return response.status(422).json({ error: "NO_FINDINGS", message: "This audit has no findings to interpret." });
    if (!interpreter) return response.status(503).json({ error: "AI_NOT_CONFIGURED", message: "AI interpretation is not configured on this server." });

    let attemptId: string | null;
    try { attemptId = await store.beginInterpretation({ auditId: id, workspaceId, provider: interpreter.provider, model: interpreter.model, promptVersion: interpreter.promptVersion }); }
    catch { return storeUnavailable(response); }
    if (!attemptId) return response.status(409).json({ error: "INTERPRETATION_IN_PROGRESS", message: "An interpretation for this audit is already being generated." });

    // interpret() never throws; provider failures come back as a failed outcome and are persisted.
    const outcome = await interpreter.interpret({ analysis, rootUrl: audit.result?.pages[0]?.url ?? "" });
    try {
      const interpretation = await store.completeInterpretation(id, attemptId, outcome);
      if (!interpretation) return response.status(409).json({ error: "INTERPRETATION_SUPERSEDED", message: "A newer interpretation request replaced this one." });
      const body: InterpretationResponse = { configured: true, interpretation };
      return response.status(200).json(body);
    } catch { return storeUnavailable(response); }
  });

  app.get("/v1/proposals", readLimit, requireWorkspace, async (request, response) => {
    const auditId = typeof request.query.auditId === "string" ? request.query.auditId : undefined;
    if (auditId !== undefined && !AUDIT_ID.test(auditId)) return response.status(400).json({ error: "INVALID_AUDIT_ID", message: "The audit identifier is invalid." });
    try {
      const body: ProposalListResponse = { proposals: await proposals.listProposalsForWorkspace(response.locals.workspaceId, auditId?.toLowerCase()) };
      return response.status(200).json(body);
    } catch { return storeUnavailable(response); }
  });

  app.post("/v1/proposals", proposalWriteLimit, requireWorkspace, async (request, response) => {
    const parsed = parseCreateProposalInput(request.body);
    if (!parsed.ok) return response.status(400).json({ error: "INVALID_PROPOSAL", message: parsed.error });
    const workspaceId: string = response.locals.workspaceId;
    try {
      const audit = await store.getAuditForWorkspace(parsed.value.auditId, workspaceId);
      if (!audit) return notFound(response);
      const resolved = await resolveForAudit(audit, parsed.value.selections, workspaceId);
      if (!resolved.ok) return response.status(resolved.status).json(resolved.body);
      const url = auditUrl(audit);
      const content = initialProposalContent({ title: parsed.value.title, client: parsed.value.client, auditUrl: url, opportunities: resolved.opportunities, newId: randomUUID });
      const proposal = await proposals.createProposal({ workspaceId, auditId: audit.id, auditUrl: url, opportunities: resolved.opportunities, content });
      const body: ProposalResponse = { proposal, aiDraftConfigured: drafter !== null };
      return response.status(201).json(body);
    } catch { return storeUnavailable(response); }
  });

  app.get("/v1/proposals/:proposalId", readLimit, requireWorkspace, requireProposalId, async (request, response) => {
    try {
      const proposal = await proposals.getProposalForWorkspace(String(request.params.proposalId).toLowerCase(), response.locals.workspaceId);
      if (!proposal) return proposalNotFound(response);
      const body: ProposalResponse = { proposal, aiDraftConfigured: drafter !== null };
      return response.status(200).json(body);
    } catch { return storeUnavailable(response); }
  });

  app.get("/v1/proposals/:proposalId/pdf", pdfLimit, requireWorkspace, requireProposalId, async (request, response) => {
    let proposal: Proposal | null;
    try {
      proposal = await proposals.getProposalForWorkspace(String(request.params.proposalId).toLowerCase(), response.locals.workspaceId);
    } catch { return storeUnavailable(response); }
    if (!proposal) return proposalNotFound(response);
    let pdf: Buffer;
    try {
      pdf = await renderProposalPdf(proposal);
    } catch {
      return response.status(500).json({ error: "PDF_RENDER_FAILED", message: "The proposal PDF could not be generated. Try again." });
    }
    response.status(200).set({
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${proposalPdfFilename(proposal)}"`,
      "content-length": String(pdf.length),
      "cache-control": "private, no-store",
    });
    return response.end(pdf);
  });

  app.put("/v1/proposals/:proposalId", proposalWriteLimit, requireWorkspace, requireProposalId, async (request, response) => {
    const parsed = parseUpdateProposalInput(request.body);
    if (!parsed.ok) return response.status(400).json({ error: "INVALID_PROPOSAL", message: parsed.error });
    const input = parsed.value;
    const workspaceId: string = response.locals.workspaceId;
    const id = String(request.params.proposalId).toLowerCase();
    try {
      const existing = await proposals.getProposalForWorkspace(id, workspaceId);
      if (!existing) return proposalNotFound(response);
      const conflict = (current: Proposal) => {
        const body: ProposalConflictResponse = { error: "PROPOSAL_CONFLICT", message: "This proposal was changed elsewhere. Reload it before saving again.", current };
        return response.status(409).json(body);
      };
      if (existing.revision !== input.revision) return conflict(existing);

      const byId = new Map(existing.opportunities.map((opportunity) => [opportunity.id, opportunity]));
      const unknown = input.opportunityIds.find((opportunityId) => !byId.has(opportunityId));
      if (unknown) return response.status(422).json({ error: "UNKNOWN_OPPORTUNITY", message: `Opportunity ${unknown} is not part of this proposal.` });
      const opportunities = input.opportunityIds.map((opportunityId) => byId.get(opportunityId)!);

      if (input.addSelections.length > 0) {
        const audit = await store.getAuditForWorkspace(existing.auditId, workspaceId);
        if (!audit) return response.status(409).json({ error: "AUDIT_UNAVAILABLE", message: "The source audit for this proposal is no longer available." });
        const resolved = await resolveForAudit(audit, input.addSelections, workspaceId);
        if (!resolved.ok) return response.status(resolved.status).json(resolved.body);
        const kept = new Set(opportunities.map((opportunity) => opportunity.id));
        opportunities.push(...resolved.opportunities.filter((opportunity) => !kept.has(opportunity.id)));
      }
      if (opportunities.length > PROPOSAL_LIMITS.maxOpportunities) return response.status(400).json({ error: "INVALID_PROPOSAL", message: `A proposal may contain at most ${PROPOSAL_LIMITS.maxOpportunities} opportunities.` });

      const linked = new Set(opportunities.map((opportunity) => opportunity.id));
      const orphan = input.content.deliverables.find((deliverable) => deliverable.opportunityIds.some((opportunityId) => !linked.has(opportunityId)));
      if (orphan) return response.status(422).json({ error: "UNKNOWN_OPPORTUNITY", message: `Deliverable "${orphan.title || orphan.id}" links to an opportunity that is not in this proposal.` });

      const result = await proposals.updateProposal({ id, workspaceId, revision: input.revision, status: input.status, opportunities, content: input.content });
      if (result.kind === "not-found") return proposalNotFound(response);
      if (result.kind === "conflict") return conflict(result.current);
      const body: ProposalResponse = { proposal: result.proposal, aiDraftConfigured: drafter !== null };
      return response.status(200).json(body);
    } catch { return storeUnavailable(response); }
  });

  app.post("/v1/proposals/:proposalId/draft", draftLimit, requireWorkspace, requireProposalId, async (request, response) => {
    const workspaceId: string = response.locals.workspaceId;
    let proposal: Proposal | null;
    let audit: AuditStatusResponse | null = null;
    try {
      proposal = await proposals.getProposalForWorkspace(String(request.params.proposalId).toLowerCase(), workspaceId);
      if (proposal) audit = await store.getAuditForWorkspace(proposal.auditId, workspaceId);
    } catch { return storeUnavailable(response); }
    if (!proposal) return proposalNotFound(response);
    if (!drafter) return response.status(503).json({ error: "AI_NOT_CONFIGURED", message: "AI drafting is not configured on this server." });
    if (proposal.opportunities.length === 0) return response.status(422).json({ error: "NO_OPPORTUNITIES", message: "Select at least one opportunity before drafting." });
    const findings = audit ? auditFindings(audit) : null;
    if (!findings) return response.status(409).json({ error: "AUDIT_UNAVAILABLE", message: "The source audit evidence for this proposal is not available." });

    // draft() never throws; provider failures come back as a failed outcome.
    const outcome = await drafter.draft({ auditUrl: proposal.auditUrl, client: proposal.client, opportunities: proposal.opportunities, findings });
    if (!outcome.ok) {
      if (outcome.failure.retryAfterSeconds) response.setHeader("Retry-After", String(outcome.failure.retryAfterSeconds));
      return response.status(draftFailureStatus(outcome.failure.code)).json({ error: outcome.failure.code, message: outcome.failure.message, ...(outcome.failure.retryAfterSeconds ? { retryAfterSeconds: outcome.failure.retryAfterSeconds } : {}) });
    }
    const body: ProposalDraftResponse = { status: outcome.status, model: drafter.model, draft: outcome.draft, rejected: outcome.rejected };
    return response.status(200).json(body);
  });

  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(error);
    const type = (error as { type?: string } | null)?.type;
    if (type === "entity.too.large") return response.status(413).json({ error: "PAYLOAD_TOO_LARGE", message: "The request body is too large." });
    if (type === "entity.parse.failed") return response.status(400).json({ error: "INVALID_JSON", message: "The request body is not valid JSON." });
    return response.status(500).json({ error: "INTERNAL_ERROR", message: "An unexpected error occurred." });
  });

  return app;
}
