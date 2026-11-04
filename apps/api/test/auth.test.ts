import type { AuditStatusResponse } from "@scopepilot/contracts/audit";
import { REGISTER_ACCEPTED_MESSAGE } from "@scopepilot/contracts/auth";
import type { AuditInterpretation } from "@scopepilot/contracts/interpretation";
import type { Proposal, ProposalSummary } from "@scopepilot/contracts/proposal";
import type { NewProposal, ProposalChanges, ProposalUpdateResult } from "@scopepilot/persistence/proposals";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApi, type AuditStore, type AuthLimits, type ProposalStore } from "../src/app.js";
import { argon2idHasher, createAuthService, hashToken, readCookie, sessionCookieName, type SessionPolicy } from "../src/auth.js";
import { proxySecret, sessionEnvironment } from "../src/env.js";
import { MemoryAuthStore, plainHasher, sessionFor } from "./auth-helpers.js";

const PASSWORD = "correct horse battery";
const finding = { id: "seo:f0", category: "seo", severity: "medium", basis: "rule-based", title: "Missing meta description", source: { tool: "scopepilot-seo-rules", ruleId: "r" }, affectedUrl: "https://example.com/", evidence: { kind: "page-signal", signal: "s", observed: 1, expected: "0" }, explanation: "e", remediation: "r", references: [] } as const;

/** Workspace-scoped in-memory audit/proposal stores with the same semantics as persistence. */
class Stores implements AuditStore, ProposalStore {
  audits = new Map<string, { workspaceId: string; audit: AuditStatusResponse }>();
  interpretations = new Map<string, { workspaceId: string; value: AuditInterpretation }>();
  proposals = new Map<string, { workspaceId: string; proposal: Proposal }>();
  private sequence = 0;
  private id() { this.sequence += 1; return this.sequence.toString(16).padStart(24, "0"); }

  async createAudit(submission: Parameters<AuditStore["createAudit"]>[0]) {
    const id = this.id();
    const audit: AuditStatusResponse = { id, status: "completed", createdAt: new Date().toISOString(), result: { pages: [{ url: submission.url, title: "x", metaDescription: null, headings: [], canonical: null, robots: null, links: [], images: [], warnings: [] }], warnings: [], analysis: { modules: { seo: { status: "completed", measurements: null, issues: [], notes: [], findingCount: 1 }, performance: { status: "unavailable", measurements: null, issues: [], notes: [], findingCount: 0 }, accessibility: { status: "completed", measurements: null, issues: [], notes: [], findingCount: 0 } }, findings: [structuredClone(finding)] } } as unknown as AuditStatusResponse["result"] };
    this.audits.set(id, { workspaceId: submission.workspaceId, audit });
    return audit;
  }
  async getAuditForWorkspace(id: string, workspaceId: string) { const entry = this.audits.get(id); return entry?.workspaceId === workspaceId ? structuredClone(entry.audit) : null; }
  async listAuditsForWorkspace(workspaceId: string) { return [...this.audits.values()].filter((e) => e.workspaceId === workspaceId).map(({ audit }) => ({ id: audit.id, domain: "example.com", createdAt: audit.createdAt, status: audit.status })); }
  async getInterpretationForWorkspace(auditId: string, workspaceId: string) { const entry = this.interpretations.get(auditId); return entry?.workspaceId === workspaceId ? entry.value : null; }
  async beginInterpretation(attempt: Parameters<AuditStore["beginInterpretation"]>[0]) {
    this.interpretations.set(attempt.auditId, { workspaceId: attempt.workspaceId, value: { auditId: attempt.auditId, status: "generating", provider: attempt.provider, model: attempt.model, promptVersion: attempt.promptVersion, startedAt: new Date().toISOString(), content: null, rejected: [], uninterpretedRefs: [] } });
    return "attempt";
  }
  async completeInterpretation(auditId: string) {
    const entry = this.interpretations.get(auditId);
    if (!entry) return null;
    entry.value = { ...entry.value, status: "failed", failure: { code: "AI_PROVIDER_ERROR", message: "x" }, completedAt: new Date().toISOString() };
    return entry.value;
  }
  async createProposal(input: NewProposal) {
    const id = this.id();
    const now = new Date().toISOString();
    const proposal = { id, auditId: input.auditId, auditUrl: input.auditUrl, status: "draft", revision: 1, opportunities: input.opportunities, ...input.content, createdAt: now, updatedAt: now } as Proposal;
    this.proposals.set(id, { workspaceId: input.workspaceId, proposal });
    return structuredClone(proposal);
  }
  async getProposalForWorkspace(id: string, workspaceId: string) { const entry = this.proposals.get(id); return entry?.workspaceId === workspaceId ? structuredClone(entry.proposal) : null; }
  async listProposalsForWorkspace(workspaceId: string): Promise<ProposalSummary[]> { return [...this.proposals.values()].filter((e) => e.workspaceId === workspaceId).map(({ proposal }) => ({ id: proposal.id } as ProposalSummary)); }
  async updateProposal(changes: ProposalChanges): Promise<ProposalUpdateResult> {
    const entry = this.proposals.get(changes.id);
    if (!entry || entry.workspaceId !== changes.workspaceId) return { kind: "not-found" };
    entry.proposal = { ...entry.proposal, ...changes.content, status: changes.status, revision: entry.proposal.revision + 1 };
    return { kind: "updated", proposal: structuredClone(entry.proposal) };
  }
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

interface Client { cookie?: string; csrf?: string }

async function start(options: { policy?: Partial<SessionPolicy>; now?: () => Date; limits?: Partial<AuthLimits>; hasher?: typeof plainHasher; registerMinMs?: number; proxySecret?: string } = {}) {
  const authStore = new MemoryAuthStore();
  const stores = new Stores();
  const auth = createAuthService({ store: authStore, hasher: options.hasher ?? plainHasher, policy: options.policy, now: options.now, registerMinMs: options.registerMinMs ?? 0 });
  const interpreter = { provider: "gemini" as const, model: "m", promptVersion: "p", interpret: async () => ({ status: "failed" as const, input: { findingCount: 1, issueGroupCount: 1, issueGroupsOmitted: 0 }, content: null, rejected: [], uninterpretedRefs: [], failure: { code: "AI_PROVIDER_ERROR", message: "x" } }) };
  const drafter = { model: "m", draft: async () => ({ ok: false as const, failure: { code: "AI_PROVIDER_ERROR", message: "x" } }) };
  const app = createApi({ auth, authLimits: options.limits, store: stores, proposals: stores, interpreter: interpreter as never, drafter: drafter as never, validateTarget: async (url) => new URL(url), proxySecret: options.proxySecret });
  const server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, client: Client = {}, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...extra };
    if (client.cookie) headers.cookie = client.cookie;
    if (client.csrf) headers["x-csrf-token"] = client.csrf;
    const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, setCookie: response.headers.getSetCookie() };
  };
  /** Registers a user, then signs in as the browser does, and returns the browser state (cookie + in-memory CSRF token). */
  const register = async (email: string, name = "User") => {
    const registered = await call("POST", "/v1/auth/register", { name, email, password: PASSWORD });
    expect(registered.status).toBe(202);
    const response = await call("POST", "/v1/auth/login", { email, password: PASSWORD });
    expect(response.status).toBe(200);
    return { client: clientFrom(response), body: response.body };
  };
  return { auth, authStore, stores, call, register };
}

function clientFrom(response: { setCookie: string[]; body: { csrfToken?: string } }): Client {
  const cookie = response.setCookie.map((value) => value.split(";")[0]).find((value) => value.startsWith("scopepilot_session=") || value.startsWith("__Host-scopepilot_session="));
  return { cookie, csrf: response.body?.csrfToken };
}

describe("registration", () => {
  it("creates a user and personal workspace without issuing a session; login then sets an HTTP-only cookie", async () => {
    const { call, authStore } = await start();
    const registered = await call("POST", "/v1/auth/register", { name: "  Ada  ", email: " Ada@Example.COM ", password: PASSWORD });
    expect(registered).toMatchObject({ status: 202, body: { status: "accepted", message: REGISTER_ACCEPTED_MESSAGE } });
    expect(registered.setCookie).toEqual([]);
    expect(authStore.sessions.size).toBe(0);
    expect(authStore.users.size).toBe(1);
    const response = await call("POST", "/v1/auth/login", { email: "ada@example.com", password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ user: { name: "Ada", email: "ada@example.com" }, workspace: { kind: "personal", role: "owner" } });
    expect(typeof response.body.csrfToken).toBe("string");
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|tokenHash|plain:/);
    const cookie = response.setCookie.find((value) => value.startsWith("scopepilot_session="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=604800/);
    expect(cookie).not.toMatch(/Secure/i);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [stored] = authStore.users.values();
    expect(stored.passwordHash).not.toBe(PASSWORD);
    // Only the hash of the cookie token is persisted.
    const token = cookie!.split(";")[0].split("=")[1];
    expect(authStore.sessions.has(hashToken(token))).toBe(true);
    expect([...authStore.sessions.keys()]).not.toContain(token);
  });

  it("gives every user a separate workspace", async () => {
    const { register } = await start();
    const a = await register("a@example.com");
    const b = await register("b@example.com");
    expect(a.body.workspace.id).not.toBe(b.body.workspace.id);
  });

  it("answers a duplicate email exactly like a new one and leaves the existing account untouched", async () => {
    const { call, register, authStore } = await start();
    const owner = await register("dup@example.com");
    const [before] = authStore.users.values();
    const fresh = await call("POST", "/v1/auth/register", { name: "New", email: "fresh@example.com", password: "another long password" });
    const duplicate = await call("POST", "/v1/auth/register", { name: "Other", email: "  DUP@example.com", password: "another long password" });
    expect(duplicate.status).toBe(fresh.status);
    expect(duplicate.body).toEqual(fresh.body);
    expect(duplicate.setCookie).toEqual(fresh.setCookie);
    expect(duplicate.setCookie).toEqual([]);
    expect([...authStore.users.values()].filter((user) => user.email === "dup@example.com")).toEqual([before]);
    // The other password does not open the existing account; the owner's still does and their session survives.
    expect((await call("POST", "/v1/auth/login", { email: "dup@example.com", password: "another long password" })).status).toBe(401);
    expect((await call("POST", "/v1/auth/login", { email: "dup@example.com", password: PASSWORD })).status).toBe(200);
    expect((await call("GET", "/v1/auth/session", undefined, owner.client)).status).toBe(200);
  });

  it("takes at least the same minimum time for new and already-registered emails", async () => {
    const { call, register } = await start({ registerMinMs: 200 });
    await register("timing@example.com");
    const timed = async (email: string) => { const started = performance.now(); const response = await call("POST", "/v1/auth/register", { name: "T", email, password: PASSWORD }); return { ms: performance.now() - started, status: response.status }; };
    const duplicate = await timed("timing@example.com");
    const fresh = await timed("timing-new@example.com");
    expect(duplicate).toMatchObject({ status: 202 });
    expect(fresh).toMatchObject({ status: 202 });
    expect(duplicate.ms).toBeGreaterThanOrEqual(190);
    expect(fresh.ms).toBeGreaterThanOrEqual(190);
  });

  it("validates name, email and password", async () => {
    const { call } = await start();
    expect(await call("POST", "/v1/auth/register", { name: "", email: "a@example.com", password: PASSWORD })).toMatchObject({ status: 400, body: { error: "INVALID_REGISTRATION", field: "name" } });
    expect(await call("POST", "/v1/auth/register", { name: "A", email: "not-an-email", password: PASSWORD })).toMatchObject({ status: 400, body: { field: "email" } });
    expect(await call("POST", "/v1/auth/register", { name: "A", email: "a@example.com", password: "short" })).toMatchObject({ status: 400, body: { field: "password" } });
    expect(await call("POST", "/v1/auth/register", { name: "A", email: "a@example.com", password: "x".repeat(129) })).toMatchObject({ status: 400, body: { field: "password" } });
    expect(await call("POST", "/v1/auth/register", { name: "A", email: "longpassword@example.com", password: "LongPassword@example.com" })).toMatchObject({ status: 400, body: { field: "password" } });
    expect(await call("POST", "/v1/auth/register", [])).toMatchObject({ status: 400, body: { field: "body" } });
  });

  it("rate-limits registration per client", async () => {
    const { call } = await start({ limits: { registerPerIp: 2 } });
    await call("POST", "/v1/auth/register", { name: "A", email: "r1@example.com", password: PASSWORD });
    await call("POST", "/v1/auth/register", { name: "A", email: "r2@example.com", password: PASSWORD });
    expect(await call("POST", "/v1/auth/register", { name: "A", email: "r3@example.com", password: PASSWORD })).toMatchObject({ status: 429, body: { error: "RATE_LIMITED" } });
  });
});

describe("login", () => {
  it("returns the same generic error for a wrong password and an unknown email", async () => {
    const { call, register } = await start();
    await register("known@example.com");
    const wrong = await call("POST", "/v1/auth/login", { email: "known@example.com", password: "wrong password!!" });
    const unknown = await call("POST", "/v1/auth/login", { email: "nobody@example.com", password: "wrong password!!" });
    expect(wrong).toMatchObject({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.setCookie).toEqual([]);
  });

  it("issues a fresh session and revokes the one the client presented (session fixation)", async () => {
    const { call, register, authStore } = await start();
    const { client: first } = await register("fix@example.com");
    const login = await call("POST", "/v1/auth/login", { email: "FIX@example.com", password: PASSWORD }, { cookie: first.cookie });
    expect(login.status).toBe(200);
    const second = clientFrom(login);
    expect(second.cookie).toBeDefined();
    expect(second.cookie).not.toBe(first.cookie);
    expect(second.csrf).not.toBe(first.csrf);
    expect((await call("GET", "/v1/auth/session", undefined, first)).status).toBe(401);
    expect((await call("GET", "/v1/auth/session", undefined, second)).status).toBe(200);
    expect(authStore.sessions.size).toBe(1);
  });

  it("validates the login body", async () => {
    const { call } = await start();
    expect(await call("POST", "/v1/auth/login", { email: "", password: "x" })).toMatchObject({ status: 400, body: { error: "INVALID_LOGIN" } });
    expect(await call("POST", "/v1/auth/login", { email: "a@example.com" })).toMatchObject({ status: 400, body: { field: "password" } });
  });

  it("limits failed attempts per email, including unknown emails, without blocking other accounts", async () => {
    const { call, register } = await start({ limits: { loginFailuresPerEmail: 3, loginPerIp: 100 } });
    await register("victim@example.com");
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await call("POST", "/v1/auth/login", { email: "victim@example.com", password: "guess guess guess" })).status).toBe(401);
    expect((await call("POST", "/v1/auth/login", { email: "Victim@example.com", password: PASSWORD })).status).toBe(429);
    for (let attempt = 0; attempt < 3; attempt += 1) await call("POST", "/v1/auth/login", { email: "ghost@example.com", password: "guess guess guess" });
    expect((await call("POST", "/v1/auth/login", { email: "ghost@example.com", password: "guess guess guess" })).status).toBe(429);
    await register("other@example.com");
    expect((await call("POST", "/v1/auth/login", { email: "other@example.com", password: PASSWORD })).status).toBe(200);
  });

  it("limits login attempts per client address", async () => {
    const { call } = await start({ limits: { loginPerIp: 2 } });
    await call("POST", "/v1/auth/login", { email: "a@example.com", password: "x" });
    await call("POST", "/v1/auth/login", { email: "b@example.com", password: "x" });
    expect((await call("POST", "/v1/auth/login", { email: "c@example.com", password: "x" })).status).toBe(429);
  });
});

describe("sessions", () => {
  it("persists across requests and exposes the current account", async () => {
    const { call, register } = await start();
    const { client, body } = await register("persist@example.com", "Persist");
    for (let index = 0; index < 3; index += 1) {
      const session = await call("GET", "/v1/auth/session", undefined, { cookie: client.cookie });
      expect(session).toMatchObject({ status: 200, body: { user: { id: body.user.id }, workspace: { id: body.workspace.id }, csrfToken: client.csrf } });
    }
    expect(await call("GET", "/v1/account", undefined, { cookie: client.cookie })).toMatchObject({ status: 200, body: { user: { email: "persist@example.com", name: "Persist" }, workspace: { id: body.workspace.id } } });
  });

  it("expires sessions at the absolute lifetime and after idling, clearing the cookie", async () => {
    let clock = new Date("2026-11-03T00:00:00Z");
    const { call, register } = await start({ now: () => clock, policy: { ttlMs: 10 * 3_600_000, idleMs: 3_600_000, touchIntervalMs: 0 } });
    const { client } = await register("expiry@example.com");
    clock = new Date(clock.getTime() + 50 * 60_000);
    expect((await call("GET", "/v1/auth/session", undefined, client)).status).toBe(200);
    // Activity slides the idle window forward.
    clock = new Date(clock.getTime() + 50 * 60_000);
    expect((await call("GET", "/v1/auth/session", undefined, client)).status).toBe(200);
    clock = new Date(clock.getTime() + 61 * 60_000);
    const idle = await call("GET", "/v1/auth/session", undefined, client);
    expect(idle.status).toBe(401);
    expect(idle.setCookie.join()).toMatch(/scopepilot_session=;.*Expires=Thu, 01 Jan 1970/);

    const { client: active } = await register("absolute@example.com");
    for (let step = 0; step < 10; step += 1) {
      clock = new Date(clock.getTime() + 55 * 60_000);
      await call("GET", "/v1/auth/session", undefined, active);
    }
    // 550 minutes of activity is still inside the 10-hour lifetime; crossing it ends the session despite activity.
    expect((await call("GET", "/v1/auth/session", undefined, active)).status).toBe(200);
    clock = new Date(clock.getTime() + 55 * 60_000);
    expect((await call("GET", "/v1/auth/session", undefined, active)).status).toBe(401);
  });

  it("rejects malformed, unknown and orphaned session tokens", async () => {
    const { call, register, authStore } = await start();
    expect((await call("GET", "/v1/auth/session", undefined, { cookie: "scopepilot_session=abc" })).status).toBe(401);
    expect((await call("GET", "/v1/auth/session", undefined, { cookie: `scopepilot_session=${"a".repeat(43)}` })).status).toBe(401);
    const { client, body } = await register("orphan@example.com");
    authStore.memberships = authStore.memberships.filter((m) => m.userId !== body.user.id);
    expect((await call("GET", "/v1/auth/session", undefined, client)).status).toBe(401);
    expect(authStore.sessions.size).toBe(0);
  });

  it("reports an unavailable auth store as 503, not as signed out", async () => {
    const { call, register, authStore } = await start();
    const { client } = await register("down@example.com");
    authStore.fail = true;
    expect(await call("GET", "/v1/audits", undefined, client)).toMatchObject({ status: 503, body: { error: "AUTH_UNAVAILABLE" } });
  });
});

describe("logout", () => {
  it("requires the CSRF token, deletes the server-side session and clears the cookie", async () => {
    const { call, register, authStore } = await start();
    const { client } = await register("logout@example.com");
    expect((await call("POST", "/v1/auth/logout", {}, { cookie: client.cookie })).status).toBe(403);
    const response = await call("POST", "/v1/auth/logout", {}, client);
    expect(response.status).toBe(204);
    expect(response.setCookie.join()).toMatch(/scopepilot_session=;/);
    expect(authStore.sessions.size).toBe(0);
    // A copy of the old cookie no longer works anywhere.
    expect((await call("GET", "/v1/auth/session", undefined, client)).status).toBe(401);
    expect((await call("GET", "/v1/audits", undefined, client)).status).toBe(401);
    expect((await call("POST", "/v1/audits", { url: "https://example.com", mode: "quick", includeMobileChecks: false, includeAccessibilityChecks: false }, client)).status).toBe(401);
  });

  it("succeeds without a session", async () => {
    const { call } = await start();
    expect((await call("POST", "/v1/auth/logout", {})).status).toBe(204);
  });
});

const AUDIT_BODY = { url: "https://example.com/", mode: "quick", includeMobileChecks: false, includeAccessibilityChecks: true };
const SOME_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

describe("protected routes", () => {
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/v1/auth/session"], ["GET", "/v1/account"],
    ["GET", "/v1/audits"], ["POST", "/v1/audits", AUDIT_BODY], ["GET", `/v1/audits/${SOME_ID}`],
    ["GET", `/v1/audits/${SOME_ID}/interpretation`], ["POST", `/v1/audits/${SOME_ID}/interpretation`, {}],
    ["GET", "/v1/proposals"], ["POST", "/v1/proposals", { auditId: SOME_ID, selections: [{ source: "finding", ref: "seo:f0" }] }],
    ["GET", `/v1/proposals/${SOME_ID}`], ["PUT", `/v1/proposals/${SOME_ID}`, {}], ["POST", `/v1/proposals/${SOME_ID}/draft`, {}],
  ];

  it.each(routes)("%s %s returns 401 without a session", async (method, path, body) => {
    const { call } = await start();
    expect(await call(method, path, body)).toMatchObject({ status: 401, body: { error: "AUTH_REQUIRED" } });
  });

  it("ignores any workspace ID supplied by the browser", async () => {
    const { call, register, stores } = await start();
    const a = await register("a@example.com");
    const b = await register("b@example.com");
    const created = await call("POST", "/v1/audits", { ...AUDIT_BODY, workspaceId: b.body.workspace.id }, a.client, { "x-workspace-id": b.body.workspace.id });
    expect(created.status).toBe(202);
    expect(stores.audits.get(created.body.id)?.workspaceId).toBe(a.body.workspace.id);
    expect((await call("GET", `/v1/audits?workspaceId=${a.body.workspace.id}`, undefined, b.client)).body.audits).toEqual([]);
  });

  it("requires the per-session CSRF token on writes", async () => {
    const { call, register } = await start();
    const a = await register("csrf@example.com");
    expect(await call("POST", "/v1/audits", AUDIT_BODY, { cookie: a.client.cookie })).toMatchObject({ status: 403, body: { error: "CSRF_INVALID" } });
    expect((await call("POST", "/v1/audits", AUDIT_BODY, { cookie: a.client.cookie, csrf: "x".repeat(43) })).status).toBe(403);
    const other = await register("csrf-other@example.com");
    expect((await call("POST", "/v1/audits", AUDIT_BODY, { cookie: a.client.cookie, csrf: other.client.csrf })).status).toBe(403);
    expect((await call("POST", "/v1/audits", AUDIT_BODY, a.client)).status).toBe(202);
  });
});

describe("cross-user isolation", () => {
  it("never lets user B read, interpret, draft or update user A's resources", async () => {
    const { call, register } = await start();
    const a = await register("owner@example.com");
    const b = await register("intruder@example.com");

    const audit = await call("POST", "/v1/audits", AUDIT_BODY, a.client);
    expect(audit.status).toBe(202);
    const auditId = audit.body.id as string;
    expect((await call("POST", `/v1/audits/${auditId}/interpretation`, {}, a.client)).status).toBe(200);
    const proposal = await call("POST", "/v1/proposals", { auditId, selections: [{ source: "finding", ref: "seo:f0" }] }, a.client);
    expect(proposal.status).toBe(201);
    const proposalId = proposal.body.proposal.id as string;

    const notFound = { status: 404 };
    expect((await call("GET", "/v1/audits", undefined, b.client)).body.audits).toEqual([]);
    expect((await call("GET", "/v1/proposals", undefined, b.client)).body.proposals).toEqual([]);
    expect(await call("GET", `/v1/audits/${auditId}`, undefined, b.client)).toMatchObject({ ...notFound, body: { error: "AUDIT_NOT_FOUND" } });
    expect(await call("GET", `/v1/audits/${auditId}/interpretation`, undefined, b.client)).toMatchObject(notFound);
    expect(await call("POST", `/v1/audits/${auditId}/interpretation`, {}, b.client)).toMatchObject(notFound);
    expect(await call("GET", `/v1/proposals?auditId=${auditId}`, undefined, b.client)).toMatchObject({ status: 200, body: { proposals: [] } });
    expect(await call("POST", "/v1/proposals", { auditId, selections: [{ source: "finding", ref: "seo:f0" }] }, b.client)).toMatchObject(notFound);
    expect(await call("GET", `/v1/proposals/${proposalId}`, undefined, b.client)).toMatchObject({ ...notFound, body: { error: "PROPOSAL_NOT_FOUND" } });
    const { id: _id, auditId: _a, auditUrl: _u, status: _s, revision: _r, opportunities: _o, createdAt: _c, updatedAt: _up, ...content } = proposal.body.proposal;
    const update = { revision: 1, status: "draft", content, opportunityIds: proposal.body.proposal.opportunities.map((o: { id: string }) => o.id) };
    expect(await call("PUT", `/v1/proposals/${proposalId}`, update, b.client)).toMatchObject(notFound);
    expect(await call("POST", `/v1/proposals/${proposalId}/draft`, {}, b.client)).toMatchObject(notFound);

    // A's own data is untouched and still reachable.
    expect(await call("GET", `/v1/proposals/${proposalId}`, undefined, a.client)).toMatchObject({ status: 200, body: { proposal: { revision: 1 } } });
    expect((await call("PUT", `/v1/proposals/${proposalId}`, update, a.client)).status).toBe(200);
    // 404 bodies are identical for "exists elsewhere" and "never existed": nothing leaks.
    const missing = await call("GET", `/v1/proposals/${"f".repeat(24)}`, undefined, b.client);
    expect(missing.body).toEqual((await call("GET", `/v1/proposals/${proposalId}`, undefined, b.client)).body);
  });
});

describe("password hashing", () => {
  it("uses Argon2id with a per-hash salt and verifies correctly", async () => {
    const first = await argon2idHasher.hash(PASSWORD);
    const second = await argon2idHasher.hash(PASSWORD);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toContain(PASSWORD);
    expect(first).not.toBe(second);
    expect(await argon2idHasher.verify(first, PASSWORD)).toBe(true);
    expect(await argon2idHasher.verify(first, `${PASSWORD}!`)).toBe(false);
    expect(await argon2idHasher.verify("not-a-hash", PASSWORD)).toBe(false);
  });

  it("registers and logs in end to end with the real hasher", async () => {
    const { call, authStore } = await start({ hasher: argon2idHasher });
    expect((await call("POST", "/v1/auth/register", { name: "Real", email: "real@example.com", password: PASSWORD })).status).toBe(202);
    expect([...authStore.users.values()][0].passwordHash).toMatch(/^\$argon2id\$/);
    expect((await call("POST", "/v1/auth/login", { email: "real@example.com", password: PASSWORD })).status).toBe(200);
    expect((await call("POST", "/v1/auth/login", { email: "real@example.com", password: "wrong password" })).status).toBe(401);
  });
});

describe("public API proxy secret", () => {
  const SECRET = "s".repeat(40);
  const via = (client = "198.51.100.7") => ({ "x-scopepilot-proxy-secret": SECRET, "x-scopepilot-client-ip": client });

  it("answers 404 to callers without the shared secret, including forged forwarding headers", async () => {
    const { call } = await start({ proxySecret: SECRET });
    const attempts: Record<string, string>[] = [{}, { "x-scopepilot-proxy-secret": "wrong" }, { "x-scopepilot-proxy-secret": `${SECRET}x` }, { "x-forwarded-for": "203.0.113.1", "x-scopepilot-client-ip": "203.0.113.1" }];
    for (const extra of attempts) {
      expect(await call("GET", "/v1/auth/session", undefined, {}, extra)).toMatchObject({ status: 404, body: { error: "NOT_FOUND" } });
      expect((await call("POST", "/v1/auth/register", { name: "A", email: "a@example.com", password: PASSWORD }, {}, extra)).status).toBe(404);
    }
    expect((await call("GET", "/v1/auth/session", undefined, {}, via())).status).toBe(401);
  });

  it("serves the full sign-in flow through the proxy", async () => {
    const { call } = await start({ proxySecret: SECRET });
    expect((await call("POST", "/v1/auth/register", { name: "A", email: "p@example.com", password: PASSWORD }, {}, via())).status).toBe(202);
    const login = await call("POST", "/v1/auth/login", { email: "p@example.com", password: PASSWORD }, {}, via());
    expect(login.status).toBe(200);
    expect((await call("GET", "/v1/auth/session", undefined, clientFrom(login), via())).status).toBe(200);
  });

  it("rate-limits per client address reported by the proxy, not per connection", async () => {
    const { call } = await start({ proxySecret: SECRET, limits: { loginPerIp: 2 } });
    for (let attempt = 0; attempt < 2; attempt += 1) await call("POST", "/v1/auth/login", { email: "a@example.com", password: "x" }, {}, via("198.51.100.1"));
    expect((await call("POST", "/v1/auth/login", { email: "a@example.com", password: "x" }, {}, via("198.51.100.1"))).status).toBe(429);
    expect((await call("POST", "/v1/auth/login", { email: "b@example.com", password: "x" }, {}, via("198.51.100.2"))).status).toBe(401);
  });

  it("is optional and must be long when set", () => {
    expect(proxySecret({})).toBeNull();
    expect(proxySecret({ SCOPEPILOT_PROXY_SECRET: SECRET })).toBe(SECRET);
    expect(() => proxySecret({ SCOPEPILOT_PROXY_SECRET: "short" })).toThrow(/at least 32 characters/);
  });
});

describe("session configuration", () => {
  it("uses secure __Host- cookies in production and refuses insecure production cookies", () => {
    expect(sessionEnvironment({ NODE_ENV: "production" })).toMatchObject({ production: true, secureCookie: true });
    expect(() => sessionEnvironment({ NODE_ENV: "production", SESSION_COOKIE_SECURE: "false" })).toThrow(/cannot be false in production/);
    expect(sessionEnvironment({})).toMatchObject({ secureCookie: false, ttlMs: 168 * 3_600_000, idleMs: 24 * 3_600_000, trustProxy: "loopback" });
    expect(sessionEnvironment({ SESSION_TTL_HOURS: "2", SESSION_IDLE_HOURS: "5", API_TRUST_PROXY: "1" })).toMatchObject({ ttlMs: 7_200_000, idleMs: 7_200_000, trustProxy: 1 });
    expect(() => sessionEnvironment({ SESSION_TTL_HOURS: "-1" })).toThrow();
    expect(sessionCookieName(true)).toBe("__Host-scopepilot_session");
    expect(sessionCookieName(false)).toBe("scopepilot_session");
  });

  it("sets Secure on the session cookie when configured", async () => {
    const { call } = await start({ policy: { secureCookie: true } });
    await call("POST", "/v1/auth/register", { name: "S", email: "secure@example.com", password: PASSWORD });
    const response = await call("POST", "/v1/auth/login", { email: "secure@example.com", password: PASSWORD });
    expect(response.setCookie[0]).toMatch(/^__Host-scopepilot_session=.*; Path=\/; .*HttpOnly; Secure; SameSite=Lax/);
  });

  it("reads only the named cookie", () => {
    expect(readCookie("a=1; scopepilot_session=tok; b=2", "scopepilot_session")).toBe("tok");
    expect(readCookie("xscopepilot_session=tok", "scopepilot_session")).toBeUndefined();
    expect(readCookie(undefined, "scopepilot_session")).toBeUndefined();
  });

  it("creates sessions directly for test fixtures with the same validation", async () => {
    const store = new MemoryAuthStore();
    const auth = createAuthService({ store, hasher: plainHasher });
    const { user, workspace } = store.seed({});
    const session = await sessionFor(store, user.id, workspace.id);
    expect(await auth.authenticate(session.token)).toMatchObject({ user: { id: user.id }, workspace: { id: workspace.id } });
  });
});
