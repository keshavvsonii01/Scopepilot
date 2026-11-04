import type { AuditAnalysis } from "@scopepilot/contracts/analysis";
import type { AuditStatusResponse } from "@scopepilot/contracts/audit";
import type { AuditInterpretation } from "@scopepilot/contracts/interpretation";
import type { InterpretationOutcome } from "@scopepilot/intelligence";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApi, type AuditStore, type Interpreter } from "../src/app.js";
import { testAuth } from "./auth-helpers.js";

const WORKSPACE = "w1";
const READY_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const RUNNING_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const EMPTY_ID = "cccccccccccccccccccccccc";
const LEGACY_ID = "dddddddddddddddddddddddd";
const OTHER_ID = "eeeeeeeeeeeeeeeeeeeeeeee";

const analysis = (findingCount: number): AuditAnalysis => ({
  modules: {
    seo: { status: "completed", measurements: null, issues: [], notes: [], findingCount },
    performance: { status: "unavailable", measurements: null, issues: [{ code: "PAGESPEED_NOT_CONFIGURED", message: "No key." }], notes: [], findingCount: 0 },
    accessibility: { status: "completed", measurements: null, issues: [], notes: [], findingCount: 0 },
  },
  findings: Array.from({ length: findingCount }, (_, index) => ({
    id: `seo:f${index}`, category: "seo", severity: "medium", basis: "rule-based", title: "t", source: { tool: "scopepilot-seo-rules", ruleId: "r" },
    affectedUrl: "https://example.com/", evidence: { kind: "page-signal", signal: "s", observed: 1, expected: "0" }, explanation: "e", remediation: "r", references: [],
  })),
});

const page = { url: "https://example.com/", title: "Example", metaDescription: null, headings: [], canonical: null, robots: null, links: [], images: [], warnings: [] };
const audit = (id: string, status: AuditStatusResponse["status"], result?: AuditStatusResponse["result"]): AuditStatusResponse => ({ id, status, createdAt: "2026-11-20T10:00:00.000Z", ...(result ? { result } : {}) });

class FakeStore implements AuditStore {
  audits = new Map<string, { workspaceId: string; audit: AuditStatusResponse }>([
    [READY_ID, { workspaceId: WORKSPACE, audit: audit(READY_ID, "partial", { pages: [page], warnings: [], analysis: analysis(2) }) }],
    [RUNNING_ID, { workspaceId: WORKSPACE, audit: audit(RUNNING_ID, "running") }],
    [EMPTY_ID, { workspaceId: WORKSPACE, audit: audit(EMPTY_ID, "completed", { pages: [page], warnings: [], analysis: analysis(0) }) }],
    [LEGACY_ID, { workspaceId: WORKSPACE, audit: audit(LEGACY_ID, "completed", { pages: [page], warnings: [] }) }],
    [OTHER_ID, { workspaceId: "w2", audit: audit(OTHER_ID, "completed", { pages: [page], warnings: [], analysis: analysis(1) }) }],
  ]);
  interpretations = new Map<string, AuditInterpretation & { attemptId: string }>();
  fail = false;

  async createAudit() { return audit("ffffffffffffffffffffffff", "queued"); }
  async getAuditForWorkspace(id: string, workspaceId: string) {
    if (this.fail) throw new Error("db down");
    const entry = this.audits.get(id);
    return entry && entry.workspaceId === workspaceId ? structuredClone(entry.audit) : null;
  }
  async listAuditsForWorkspace(workspaceId: string) {
    if (this.fail) throw new Error("db down");
    return [...this.audits.values()].filter((entry) => entry.workspaceId === workspaceId).map(({ audit: item }) => ({ id: item.id, domain: "example.com", createdAt: item.createdAt, status: item.status }));
  }
  async getInterpretationForWorkspace(auditId: string) {
    const record = this.interpretations.get(auditId);
    if (!record) return null;
    const { attemptId: _attemptId, ...rest } = record;
    return rest;
  }
  async beginInterpretation(attempt: Parameters<AuditStore["beginInterpretation"]>[0]) {
    if (this.interpretations.get(attempt.auditId)?.status === "generating") return null;
    const attemptId = `attempt-${this.interpretations.size + 1}`;
    this.interpretations.set(attempt.auditId, { auditId: attempt.auditId, attemptId, status: "generating", provider: attempt.provider, model: attempt.model, promptVersion: attempt.promptVersion, startedAt: new Date().toISOString(), content: null, rejected: [], uninterpretedRefs: [] });
    return attemptId;
  }
  async completeInterpretation(auditId: string, attemptId: string, outcome: InterpretationOutcome) {
    const record = this.interpretations.get(auditId);
    if (!record || record.attemptId !== attemptId) return null;
    const { status, input, content, rejected, uninterpretedRefs, failure } = outcome;
    this.interpretations.set(auditId, { ...record, status, input, content, rejected, uninterpretedRefs, ...(failure ? { failure } : {}), completedAt: new Date().toISOString() });
    return this.getInterpretationForWorkspace(auditId);
  }
}

const completedOutcome: InterpretationOutcome = {
  status: "completed",
  input: { findingCount: 2, issueGroupCount: 1, issueGroupsOmitted: 0 },
  content: { overview: "One SEO issue.", issues: [{ ref: "I1", category: "seo", ruleId: "r", title: "t", severity: "medium", findingIds: ["seo:f0", "seo:f1"], plainLanguage: "p", whyItMatters: "w", businessRelevance: "may b", recommendedImprovements: ["i"] }], opportunities: [], evidenceGaps: ["Performance was not measured."] },
  rejected: [],
  uninterpretedRefs: [],
};

function fakeInterpreter(outcome: InterpretationOutcome | (() => Promise<InterpretationOutcome>)): Interpreter & { calls: Array<{ analysis: AuditAnalysis; rootUrl: string }> } {
  const calls: Array<{ analysis: AuditAnalysis; rootUrl: string }> = [];
  return { provider: "gemini", model: "gemini-test", promptVersion: "test", calls, interpret: async (input) => { calls.push(input); return typeof outcome === "function" ? outcome() : outcome; } };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function start(options: { store?: FakeStore; interpreter?: Interpreter | null; workspace?: string | null } = {}) {
  const store = options.store ?? new FakeStore();
  const { auth, headers } = await testAuth(options.workspace === undefined ? WORKSPACE : options.workspace);
  const app = createApi({ auth, store, interpreter: options.interpreter ?? null, validateTarget: async (url) => new URL(url) });
  const server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers } });
    return { status: response.status, body: await response.json() };
  };
  return { store, call };
}

describe("audit reads", () => {
  it("lists audits for the resolved workspace only", async () => {
    const { call } = await start();
    const { status, body } = await call("GET", "/v1/audits");
    expect(status).toBe(200);
    expect(body.audits.map((item: { id: string }) => item.id)).toEqual([READY_ID, RUNNING_ID, EMPTY_ID, LEGACY_ID]);
  });

  it("requires a workspace", async () => {
    const { call } = await start({ workspace: null });
    expect((await call("GET", "/v1/audits")).status).toBe(401);
    expect((await call("GET", `/v1/audits/${READY_ID}/interpretation`)).status).toBe(401);
  });

  it("validates IDs and scopes audits to the workspace", async () => {
    const { call } = await start();
    expect(await call("GET", "/v1/audits/not-an-id")).toMatchObject({ status: 400, body: { error: "INVALID_AUDIT_ID" } });
    expect(await call("GET", `/v1/audits/${OTHER_ID}`)).toMatchObject({ status: 404 });
    expect(await call("GET", `/v1/audits/${READY_ID}`)).toMatchObject({ status: 200, body: { id: READY_ID, status: "partial" } });
  });

  it("allows report polling beyond the submission limit", async () => {
    const { call } = await start();
    for (let index = 0; index < 15; index += 1) expect((await call("GET", `/v1/audits/${RUNNING_ID}`)).status).toBe(200);
  });

  it("reports storage failures as unavailable", async () => {
    const store = new FakeStore();
    store.fail = true;
    const { call } = await start({ store });
    expect(await call("GET", "/v1/audits")).toMatchObject({ status: 503, body: { error: "STORE_UNAVAILABLE" } });
    expect(await call("GET", `/v1/audits/${READY_ID}`)).toMatchObject({ status: 503 });
  });
});

describe("AI interpretation endpoints", () => {
  it("reports whether AI is configured without exposing configuration", async () => {
    const unconfigured = await start();
    expect(await unconfigured.call("GET", `/v1/audits/${READY_ID}/interpretation`)).toEqual({ status: 200, body: { configured: false, interpretation: null } });
    const configured = await start({ interpreter: fakeInterpreter(completedOutcome) });
    expect((await configured.call("GET", `/v1/audits/${READY_ID}/interpretation`)).body).toEqual({ configured: true, interpretation: null });
    expect((await configured.call("GET", `/v1/audits/${OTHER_ID}/interpretation`)).status).toBe(404);
  });

  it("generates, persists and retrieves an interpretation without changing the audit", async () => {
    const ai = fakeInterpreter(completedOutcome);
    const { call, store } = await start({ interpreter: ai });
    const before = structuredClone(store.audits.get(READY_ID)!.audit);
    const generated = await call("POST", `/v1/audits/${READY_ID}/interpretation`);
    expect(generated.status).toBe(200);
    expect(generated.body.interpretation).toMatchObject({ auditId: READY_ID, status: "completed", provider: "gemini", model: "gemini-test", content: completedOutcome.content });
    expect(ai.calls[0]).toEqual({ rootUrl: "https://example.com/", analysis: before.result!.analysis });
    expect((await call("GET", `/v1/audits/${READY_ID}/interpretation`)).body.interpretation).toEqual(generated.body.interpretation);
    expect(store.audits.get(READY_ID)!.audit).toEqual(before);
  });

  it("persists provider failures as a failed interpretation", async () => {
    const failure: InterpretationOutcome = { status: "failed", input: completedOutcome.input, content: null, rejected: [], uninterpretedRefs: [], failure: { code: "AI_RATE_LIMITED", message: "Rate limited.", retryAfterSeconds: 20 } };
    const { call } = await start({ interpreter: fakeInterpreter(failure) });
    const response = await call("POST", `/v1/audits/${READY_ID}/interpretation`);
    expect(response).toMatchObject({ status: 200, body: { interpretation: { status: "failed", content: null, failure: { code: "AI_RATE_LIMITED", retryAfterSeconds: 20 } } } });
    expect((await call("GET", `/v1/audits/${READY_ID}/interpretation`)).body.interpretation.status).toBe("failed");
  });

  it.each([
    [RUNNING_ID, 409, "AUDIT_NOT_READY"],
    [LEGACY_ID, 422, "ANALYSIS_UNAVAILABLE"],
    [EMPTY_ID, 422, "NO_FINDINGS"],
    [OTHER_ID, 404, "AUDIT_NOT_FOUND"],
  ])("rejects interpretation of %s with %i %s", async (id, status, error) => {
    const ai = fakeInterpreter(completedOutcome);
    const { call } = await start({ interpreter: ai });
    expect(await call("POST", `/v1/audits/${id}/interpretation`)).toMatchObject({ status, body: { error } });
    expect(ai.calls).toHaveLength(0);
  });

  it("returns 503 when AI is not configured", async () => {
    const { call } = await start();
    expect(await call("POST", `/v1/audits/${READY_ID}/interpretation`)).toMatchObject({ status: 503, body: { error: "AI_NOT_CONFIGURED" } });
  });

  it("rejects a concurrent generation for the same audit", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { call } = await start({ interpreter: fakeInterpreter(async () => { await gate; return completedOutcome; }) });
    const first = call("POST", `/v1/audits/${READY_ID}/interpretation`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await call("POST", `/v1/audits/${READY_ID}/interpretation`)).toMatchObject({ status: 409, body: { error: "INTERPRETATION_IN_PROGRESS" } });
    release();
    expect((await first).status).toBe(200);
  });
});
