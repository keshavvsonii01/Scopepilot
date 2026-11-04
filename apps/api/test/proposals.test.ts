import type { AuditAnalysis, AuditFinding } from "@scopepilot/contracts/analysis";
import type { AuditStatusResponse } from "@scopepilot/contracts/audit";
import type { AuditInterpretation } from "@scopepilot/contracts/interpretation";
import type { Proposal, ProposalContent } from "@scopepilot/contracts/proposal";
import { proposalTotal } from "@scopepilot/contracts/proposal";
import type { DraftOutcome } from "@scopepilot/intelligence";
import type { NewProposal, ProposalChanges, ProposalUpdateResult } from "@scopepilot/persistence/proposals";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { testAuth } from "./auth-helpers.js";
import { createApi, type AuditStore, type Drafter, type ProposalStore } from "../src/app.js";

const WORKSPACE = "w1";
const READY_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RUNNING_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const OTHER_ID = "eeeeeeeeeeeeeeeeeeeeeeee";
const STARTED_AT = "2026-11-20T10:00:00.000Z";

const finding = (id: string, severity: AuditFinding["severity"] = "medium"): AuditFinding => ({
  id, category: "seo", severity, basis: "rule-based", title: `Title ${id}`, source: { tool: "scopepilot-seo-rules", ruleId: "r" },
  affectedUrl: "https://example.com/", evidence: { kind: "page-signal", signal: "s", observed: 1, expected: "0" }, explanation: "e", remediation: `Fix ${id}`, references: [],
});
const analysis: AuditAnalysis = {
  modules: {
    seo: { status: "completed", measurements: null, issues: [], notes: [], findingCount: 2 },
    performance: { status: "unavailable", measurements: null, issues: [{ code: "PAGESPEED_NOT_CONFIGURED", message: "No key." }], notes: [], findingCount: 0 },
    accessibility: { status: "completed", measurements: null, issues: [], notes: [], findingCount: 0 },
  },
  findings: [finding("seo:f0", "high"), finding("seo:f1")],
};
const page = { url: "https://example.com/", title: "Example", metaDescription: null, headings: [], canonical: null, robots: null, links: [], images: [], warnings: [] };
const audit = (id: string, status: AuditStatusResponse["status"], withAnalysis = true): AuditStatusResponse => ({ id, status, createdAt: STARTED_AT, ...(status === "running" ? {} : { result: { pages: [page], warnings: [], ...(withAnalysis ? { analysis } : {}) } }) });

const interpretation: AuditInterpretation = {
  auditId: READY_ID, status: "completed", provider: "gemini", model: "m", promptVersion: "p", startedAt: STARTED_AT, rejected: [], uninterpretedRefs: [],
  content: {
    overview: "o",
    issues: [{ ref: "I1", category: "seo", ruleId: "r", title: "AI issue", severity: "medium", findingIds: ["seo:f0", "seo:f1"], plainLanguage: "plain", whyItMatters: "w", businessRelevance: "may", recommendedImprovements: ["i"] }],
    opportunities: [
      { title: "SEO clean-up", summary: "s", refs: ["I1"], deliverables: ["d"], findingIds: ["seo:f0"] },
      { title: "Fabricated", summary: "s", refs: ["I9"], deliverables: ["d"], findingIds: ["seo:missing"] },
    ],
    evidenceGaps: [],
  },
};

class FakeAuditStore implements AuditStore {
  audits = new Map<string, { workspaceId: string; audit: AuditStatusResponse }>([
    [READY_ID, { workspaceId: WORKSPACE, audit: audit(READY_ID, "partial") }],
    [RUNNING_ID, { workspaceId: WORKSPACE, audit: audit(RUNNING_ID, "running") }],
    [OTHER_ID, { workspaceId: "w2", audit: audit(OTHER_ID, "completed") }],
  ]);
  interpretation: AuditInterpretation | null = interpretation;
  async createAudit() { return audit("ffffffffffffffffffffffff", "queued"); }
  async getAuditForWorkspace(id: string, workspaceId: string) {
    const entry = this.audits.get(id);
    return entry && entry.workspaceId === workspaceId ? structuredClone(entry.audit) : null;
  }
  async listAuditsForWorkspace() { return []; }
  async getInterpretationForWorkspace(auditId: string, workspaceId: string) {
    return auditId === READY_ID && workspaceId === WORKSPACE ? this.interpretation : null;
  }
  async beginInterpretation() { return null; }
  async completeInterpretation() { return null; }
}

class FakeProposalStore implements ProposalStore {
  records = new Map<string, { workspaceId: string; proposal: Proposal }>();
  fail = false;
  private next = 1;
  async createProposal(input: NewProposal) {
    if (this.fail) throw new Error("db down");
    const id = String(this.next++).padStart(24, "0");
    const proposal: Proposal = { id, auditId: input.auditId, auditUrl: input.auditUrl, status: "draft", revision: 1, opportunities: input.opportunities, ...input.content, createdAt: STARTED_AT, updatedAt: STARTED_AT };
    this.records.set(id, { workspaceId: input.workspaceId, proposal });
    return structuredClone(proposal);
  }
  async getProposalForWorkspace(id: string, workspaceId: string) {
    if (this.fail) throw new Error("db down");
    const entry = this.records.get(id);
    return entry && entry.workspaceId === workspaceId ? structuredClone(entry.proposal) : null;
  }
  async listProposalsForWorkspace(workspaceId: string, auditId?: string) {
    return [...this.records.values()].filter((entry) => entry.workspaceId === workspaceId && (!auditId || entry.proposal.auditId === auditId)).map(({ proposal }) => ({ id: proposal.id, auditId: proposal.auditId, title: proposal.title, businessName: proposal.client.businessName, status: proposal.status, opportunityCount: proposal.opportunities.length, currency: proposal.pricing.currency, total: proposalTotal(proposal.pricing), createdAt: proposal.createdAt, updatedAt: proposal.updatedAt }));
  }
  async updateProposal(changes: ProposalChanges): Promise<ProposalUpdateResult> {
    const entry = this.records.get(changes.id);
    if (!entry || entry.workspaceId !== changes.workspaceId) return { kind: "not-found" };
    if (entry.proposal.revision !== changes.revision) return { kind: "conflict", current: structuredClone(entry.proposal) };
    entry.proposal = { ...entry.proposal, ...changes.content, status: changes.status, opportunities: changes.opportunities, revision: entry.proposal.revision + 1 };
    return { kind: "updated", proposal: structuredClone(entry.proposal) };
  }
}

function fakeDrafter(outcome: DraftOutcome): Drafter & { calls: unknown[] } {
  const calls: unknown[] = [];
  return { model: "gemini-test", calls, draft: async (input) => { calls.push(input); return outcome; } };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(options: { workspace?: string; drafter?: Drafter | null; audits?: FakeAuditStore; proposals?: FakeProposalStore } = {}) {
  const audits = options.audits ?? new FakeAuditStore();
  const proposals = options.proposals ?? new FakeProposalStore();
  const { auth, headers } = await testAuth(options.workspace ?? WORKSPACE);
  const app = createApi({ auth, store: audits, proposals, drafter: options.drafter ?? null, validateTarget: async (url) => new URL(url) });
  const server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const raw = (path: string, authenticated = true) => fetch(`${base}${path}`, authenticated ? { headers } : {});
  return { audits, proposals, call, raw };
}

function contentOf(proposal: Proposal): ProposalContent {
  const { title, client, overview, objectives, scope, deliverables, milestones, pricing, terms } = proposal;
  return { title, client, overview, objectives, scope, deliverables, milestones, pricing, terms };
}

async function created(call: Awaited<ReturnType<typeof start>>["call"]) {
  const response = await call("POST", "/v1/proposals", { auditId: READY_ID, selections: [{ source: "finding", ref: "seo:f0" }, { source: "ai-issue", ref: "I1" }], client: { businessName: "Acme" } });
  expect(response.status).toBe(201);
  return response.body.proposal as Proposal;
}

describe("proposal creation", () => {
  it("creates a draft from evidence-backed selections and seeds deliverables", async () => {
    const { call, audits } = await start();
    const before = structuredClone(audits.audits.get(READY_ID));
    const proposal = await created(call);
    expect(proposal).toMatchObject({ auditId: READY_ID, auditUrl: "https://example.com/", status: "draft", revision: 1, client: { businessName: "Acme", website: "https://example.com/" } });
    expect(proposal.opportunities).toEqual([
      expect.objectContaining({ id: "finding:seo:f0", source: "finding", origin: "rule-based", findingIds: ["seo:f0"], severity: "high", summary: "Fix seo:f0" }),
      expect.objectContaining({ id: `ai-issue:I1@${STARTED_AT}`, source: "ai-issue", origin: "ai-suggestion", findingIds: ["seo:f0", "seo:f1"], severity: "high", interpretationStartedAt: STARTED_AT }),
    ]);
    expect(proposal.opportunities[1]!.evidence.map((item) => item.findingId)).toEqual(["seo:f0", "seo:f1"]);
    expect(proposal.deliverables.map((item) => [item.origin, item.opportunityIds])).toEqual([["rule-based", ["finding:seo:f0"]], ["ai-suggestion", [`ai-issue:I1@${STARTED_AT}`]]]);
    expect(proposal.pricing).toEqual({ currency: "USD", lineItems: [], paymentTerms: "" });
    expect(proposal).not.toHaveProperty("workspaceId");
    expect(audits.audits.get(READY_ID)).toEqual(before);
  });

  it("refuses selections that are not backed by audit evidence", async () => {
    const { call, audits } = await start();
    expect(await call("POST", "/v1/proposals", { auditId: READY_ID, selections: [{ source: "finding", ref: "seo:invented" }] })).toMatchObject({ status: 422, body: { error: "INVALID_SELECTION" } });
    expect(await call("POST", "/v1/proposals", { auditId: READY_ID, selections: [{ source: "ai-opportunity", ref: "O1" }] })).toMatchObject({ status: 422, body: { error: "INVALID_SELECTION" } });
    expect(await call("POST", "/v1/proposals", { auditId: READY_ID, selections: [{ source: "ai-issue", ref: "I7" }] })).toMatchObject({ status: 422 });
    audits.interpretation = null;
    expect(await call("POST", "/v1/proposals", { auditId: READY_ID, selections: [{ source: "ai-opportunity", ref: "O0" }] })).toMatchObject({ status: 422, body: { error: "INVALID_SELECTION" } });
  });

  it("validates input and audit readiness", async () => {
    const { call } = await start();
    expect(await call("POST", "/v1/proposals", { auditId: READY_ID, selections: [] })).toMatchObject({ status: 400, body: { error: "INVALID_PROPOSAL" } });
    expect(await call("POST", "/v1/proposals", { auditId: "nope", selections: [{ source: "finding", ref: "seo:f0" }] })).toMatchObject({ status: 400 });
    expect(await call("POST", "/v1/proposals", { auditId: READY_ID, selections: [{ source: "finding", ref: "seo:f0" }, { source: "finding", ref: "seo:f0" }] })).toMatchObject({ status: 400 });
    expect(await call("POST", "/v1/proposals", { auditId: RUNNING_ID, selections: [{ source: "finding", ref: "seo:f0" }] })).toMatchObject({ status: 409, body: { error: "AUDIT_NOT_READY" } });
    expect(await call("POST", "/v1/proposals", "{not json")).toMatchObject({ status: 400, body: { error: "INVALID_JSON" } });
  });

  it("reports storage failures", async () => {
    const proposals = new FakeProposalStore();
    proposals.fail = true;
    const { call } = await start({ proposals });
    expect(await call("POST", "/v1/proposals", { auditId: READY_ID, selections: [{ source: "finding", ref: "seo:f0" }] })).toMatchObject({ status: 503, body: { error: "STORE_UNAVAILABLE" } });
  });
});

describe("proposal workspace isolation", () => {
  it("scopes create, read, list and update to the resolved workspace", async () => {
    const proposals = new FakeProposalStore();
    const audits = new FakeAuditStore();
    const mine = await start({ proposals, audits });
    const theirs = await start({ proposals, audits, workspace: "w2" });
    const proposal = await created(mine.call);

    expect(await theirs.call("POST", "/v1/proposals", { auditId: READY_ID, selections: [{ source: "finding", ref: "seo:f0" }] })).toMatchObject({ status: 404, body: { error: "AUDIT_NOT_FOUND" } });
    expect(await theirs.call("GET", `/v1/proposals/${proposal.id}`)).toMatchObject({ status: 404, body: { error: "PROPOSAL_NOT_FOUND" } });
    expect((await theirs.call("GET", "/v1/proposals")).body).toEqual({ proposals: [] });
    expect(await theirs.call("PUT", `/v1/proposals/${proposal.id}`, { revision: 1, status: "sent", content: contentOf(proposal), opportunityIds: [] })).toMatchObject({ status: 404 });
    expect(await theirs.call("POST", `/v1/proposals/${proposal.id}/draft`)).toMatchObject({ status: 404 });

    expect((await mine.call("GET", "/v1/proposals")).body.proposals).toHaveLength(1);
    expect((await mine.call("GET", `/v1/proposals?auditId=${OTHER_ID}`)).body.proposals).toHaveLength(0);
    expect(await mine.call("GET", "/v1/proposals?auditId=bad")).toMatchObject({ status: 400 });
    expect(await mine.call("GET", "/v1/proposals/bad")).toMatchObject({ status: 400, body: { error: "INVALID_PROPOSAL_ID" } });
  });
});

describe("proposal editing", () => {
  it("saves edits, increments the revision and lists totals", async () => {
    const { call } = await start();
    const proposal = await created(call);
    const content: ProposalContent = {
      ...contentOf(proposal),
      overview: { text: "Overview", origin: "user" },
      objectives: [{ id: "o1", text: "Fix SEO", origin: "user" }],
      milestones: [{ id: "m1", title: "Kick-off", description: "", duration: "1 week", targetDate: "2026-12-01", origin: "user" }],
      pricing: { currency: "eur", lineItems: [{ id: "l1", label: "SEO", amount: 1500 }, { id: "l2", label: "QA", amount: 250.5 }], paymentTerms: "50% upfront" },
      terms: { text: "Standard terms", origin: "user" },
    };
    const saved = await call("PUT", `/v1/proposals/${proposal.id}`, { revision: 1, status: "sent", content, opportunityIds: proposal.opportunities.map((item) => item.id) });
    expect(saved).toMatchObject({ status: 200, body: { proposal: { revision: 2, status: "sent", pricing: { currency: "EUR" }, milestones: [{ targetDate: "2026-12-01" }] }, aiDraftConfigured: false } });
    expect((await call("GET", "/v1/proposals")).body.proposals[0]).toMatchObject({ status: "sent", total: 1750.5, currency: "EUR", opportunityCount: 2 });
    expect((await call("GET", `/v1/proposals/${proposal.id}`)).body.proposal.overview).toEqual({ text: "Overview", origin: "user" });
  });

  it("rejects stale revisions with the current proposal", async () => {
    const { call } = await start();
    const proposal = await created(call);
    const update = { revision: 1, status: "draft", content: contentOf(proposal), opportunityIds: [] as string[] };
    update.content.deliverables = [];
    expect((await call("PUT", `/v1/proposals/${proposal.id}`, update)).status).toBe(200);
    expect(await call("PUT", `/v1/proposals/${proposal.id}`, update)).toMatchObject({ status: 409, body: { error: "PROPOSAL_CONFLICT", current: { revision: 2 } } });
  });

  it("deselects and adds opportunities while keeping them tied to evidence", async () => {
    const { call } = await start();
    const proposal = await created(call);
    const content = { ...contentOf(proposal), deliverables: proposal.deliverables.filter((item) => item.opportunityIds.includes("finding:seo:f0")) };
    const saved = await call("PUT", `/v1/proposals/${proposal.id}`, { revision: 1, status: "draft", content, opportunityIds: ["finding:seo:f0"], addSelections: [{ source: "finding", ref: "seo:f1" }, { source: "finding", ref: "seo:f0" }] });
    expect(saved.status).toBe(200);
    expect(saved.body.proposal.opportunities.map((item: { id: string }) => item.id)).toEqual(["finding:seo:f0", "finding:seo:f1"]);

    const next = saved.body.proposal as Proposal;
    expect(await call("PUT", `/v1/proposals/${proposal.id}`, { revision: 2, status: "draft", content: contentOf(next), opportunityIds: ["finding:invented"] })).toMatchObject({ status: 422, body: { error: "UNKNOWN_OPPORTUNITY" } });
    expect(await call("PUT", `/v1/proposals/${proposal.id}`, { revision: 2, status: "draft", content: contentOf(next), opportunityIds: [] })).toMatchObject({ status: 422, body: { error: "UNKNOWN_OPPORTUNITY" } });
    expect(await call("PUT", `/v1/proposals/${proposal.id}`, { revision: 2, status: "draft", content: contentOf(next), opportunityIds: ["finding:seo:f0", "finding:seo:f1"], addSelections: [{ source: "finding", ref: "seo:nope" }] })).toMatchObject({ status: 422, body: { error: "INVALID_SELECTION" } });
  });

  it("validates edited content", async () => {
    const { call } = await start();
    const proposal = await created(call);
    const put = (content: unknown, extra: Record<string, unknown> = {}) => call("PUT", `/v1/proposals/${proposal.id}`, { revision: 1, status: "draft", content, opportunityIds: [], ...extra });
    const base = { ...contentOf(proposal), deliverables: [] };
    expect(await put({ ...base, pricing: { ...base.pricing, lineItems: [{ id: "l1", label: "x", amount: -5 }] } })).toMatchObject({ status: 400, body: { error: "INVALID_PROPOSAL" } });
    expect(await put({ ...base, pricing: { ...base.pricing, currency: "dollars" } })).toMatchObject({ status: 400 });
    expect(await put({ ...base, client: { ...base.client, contactEmail: "not-an-email" } })).toMatchObject({ status: 400 });
    expect(await put({ ...base, client: { ...base.client, website: "javascript:alert(1)" } })).toMatchObject({ status: 400 });
    expect(await put({ ...base, title: "" })).toMatchObject({ status: 400 });
    expect(await put({ ...base, milestones: [{ id: "m1", title: "t", description: "", duration: "", targetDate: "2026-02-31", origin: "user" }] })).toMatchObject({ status: 400 });
    expect(await put({ ...base, objectives: [{ id: "x", text: "a", origin: "user" }, { id: "x", text: "b", origin: "user" }] })).toMatchObject({ status: 400 });
    expect(await put({ ...base, overview: { text: "x", origin: "measured" } })).toMatchObject({ status: 400 });
    expect(await put(base, { status: "won" })).toMatchObject({ status: 400 });
    expect(await put(base, { revision: 0 })).toMatchObject({ status: 400 });
  });
});

describe("AI proposal drafting", () => {
  const draft = { overview: "o", objectives: ["a"], scope: "s", deliverables: [{ title: "t", description: "d", opportunityIds: ["finding:seo:f0"] }], milestones: [] };

  it("reports when AI drafting is not configured", async () => {
    const { call } = await start();
    const proposal = await created(call);
    expect((await call("GET", `/v1/proposals/${proposal.id}`)).body.aiDraftConfigured).toBe(false);
    expect(await call("POST", `/v1/proposals/${proposal.id}/draft`)).toMatchObject({ status: 503, body: { error: "AI_NOT_CONFIGURED" } });
  });

  it("returns validated suggestions without saving them", async () => {
    const drafter = fakeDrafter({ ok: true, status: "partial", draft, rejected: [{ path: "objectives[1]", reason: "r" }] });
    const { call, proposals } = await start({ drafter });
    const proposal = await created(call);
    expect(await call("POST", `/v1/proposals/${proposal.id}/draft`)).toMatchObject({ status: 200, body: { status: "partial", model: "gemini-test", draft, rejected: [{ path: "objectives[1]" }] } });
    expect(drafter.calls[0]).toMatchObject({ auditUrl: "https://example.com/", client: { businessName: "Acme" }, findings: analysis.findings });
    expect([...proposals.records.values()][0]!.proposal.revision).toBe(1);
  });

  it("maps provider failures to HTTP errors", async () => {
    const limited = await start({ drafter: fakeDrafter({ ok: false, failure: { code: "AI_RATE_LIMITED", message: "slow down", retryAfterSeconds: 20 }, rejected: [] }) });
    const first = await created(limited.call);
    const response = await limited.call("POST", `/v1/proposals/${first.id}/draft`);
    expect(response).toMatchObject({ status: 429, body: { error: "AI_RATE_LIMITED", retryAfterSeconds: 20 } });
    expect(response.headers.get("retry-after")).toBe("20");

    const timeout = await start({ drafter: fakeDrafter({ ok: false, failure: { code: "AI_TIMEOUT", message: "t" }, rejected: [] }) });
    expect(await timeout.call("POST", `/v1/proposals/${(await created(timeout.call)).id}/draft`)).toMatchObject({ status: 504 });
    const invalid = await start({ drafter: fakeDrafter({ ok: false, failure: { code: "AI_INVALID_OUTPUT", message: "bad" }, rejected: [] }) });
    expect(await invalid.call("POST", `/v1/proposals/${(await created(invalid.call)).id}/draft`)).toMatchObject({ status: 422 });
    const broken = await start({ drafter: fakeDrafter({ ok: false, failure: { code: "AI_PROVIDER_ERROR", message: "500" }, rejected: [] }) });
    expect(await broken.call("POST", `/v1/proposals/${(await created(broken.call)).id}/draft`)).toMatchObject({ status: 502 });
  });
});

describe("proposal PDF export", () => {
  it("returns a PDF attachment of the saved proposal for its own workspace without modifying it", async () => {
    const { call, raw, proposals } = await start();
    const proposal = await created(call);
    const before = structuredClone(proposals.records.get(proposal.id)!.proposal);
    const response = await raw(`/v1/proposals/${proposal.id}/pdf`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="scopepilot-proposal-[a-z0-9-]+\.pdf"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(Number(response.headers.get("content-length"))).toBe(body.length);
    expect(proposals.records.get(proposal.id)!.proposal).toEqual(before);
  });

  it("requires authentication", async () => {
    const { call, raw } = await start();
    const proposal = await created(call);
    const response = await raw(`/v1/proposals/${proposal.id}/pdf`, false);
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toMatch(/json/);
  });

  it("returns the same 404 for another workspace's proposal as for a missing one", async () => {
    const proposals = new FakeProposalStore();
    const owner = await start({ proposals });
    const proposal = await created(owner.call);
    const intruder = await start({ workspace: "w2", proposals });
    const foreign = await intruder.raw(`/v1/proposals/${proposal.id}/pdf`);
    const missing = await intruder.raw(`/v1/proposals/${"f".repeat(24)}/pdf`);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect((await intruder.raw("/v1/proposals/not-an-id/pdf")).status).toBe(400);
  });

  it("reports storage failures without a PDF", async () => {
    const { call, raw, proposals } = await start();
    const proposal = await created(call);
    proposals.fail = true;
    const response = await raw(`/v1/proposals/${proposal.id}/pdf`);
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toMatch(/json/);
  });
});