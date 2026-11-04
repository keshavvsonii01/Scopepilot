/**
 * Real two-account isolation test: the production API, persistence (MongoDB) and Argon2id hashing,
 * driven over HTTP exactly as the web proxy calls it. Runs only when SCOPEPILOT_TEST_MONGODB_URI is set,
 * against SCOPEPILOT_TEST_MONGODB_DB (default "scopepilot_test"). Every record it creates is deleted afterwards.
 */
import { ensureAuthIndexes } from "@scopepilot/persistence/auth";
import { configureMongoDns, parseDnsServers } from "@scopepilot/persistence/dns";
import { claimLegacyWorkspaceData } from "@scopepilot/persistence/migration";
import mongoose, { Types } from "mongoose";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "../src/app.js";
import { createAuthService } from "../src/auth.js";
import * as store from "../src/store.js";

const uri = process.env.SCOPEPILOT_TEST_MONGODB_URI;
const runId = randomUUID().slice(0, 8);
const emailA = `owner-${runId}@scopepilot.test`;
const emailB = `intruder-${runId}@scopepilot.test`;
const legacyWorkspace = `legacy-test-${runId}`;
const PASSWORD = "integration password 1";
const finding = { id: "seo:f0", category: "seo", severity: "medium", basis: "rule-based", title: "Missing meta description", source: { tool: "scopepilot-seo-rules", ruleId: "meta-description-missing" }, affectedUrl: "https://example.com/", evidence: { kind: "page-signal", signal: "metaDescription", observed: null, expected: "present" }, explanation: "e", remediation: "r", references: [] };
const result = { pages: [{ url: "https://example.com/", title: "Example", metaDescription: null, headings: [], canonical: null, robots: null, links: [], images: [], warnings: [] }], warnings: [], analysis: { modules: { seo: { status: "completed", measurements: null, issues: [], notes: [], findingCount: 1 }, performance: { status: "unavailable", measurements: null, issues: [], notes: [], findingCount: 0 }, accessibility: { status: "completed", measurements: null, issues: [], notes: [], findingCount: 0 } }, findings: [finding] } };

interface Client { cookie?: string; csrf?: string }
let server: Server;
let base = "";
const workspaces: string[] = [legacyWorkspace];

async function call(method: string, path: string, body?: unknown, client: Client = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (client.cookie) headers.cookie = client.cookie;
  if (client.csrf) headers["x-csrf-token"] = client.csrf;
  const response = await fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: response.headers.getSetCookie() };
}

function signedIn(response: Awaited<ReturnType<typeof call>>): Client {
  const cookie = response.setCookie.map((value) => value.split(";")[0]).find((value) => value.startsWith("scopepilot_session="));
  return { cookie, csrf: response.body.csrfToken };
}

/** Registration never signs in (it answers identically for taken emails), so the browser signs in next. */
async function registerAndSignIn(name: string, email: string) {
  const registered = await call("POST", "/v1/auth/register", { name, email, password: PASSWORD });
  expect(registered.status).toBe(202);
  expect(registered.setCookie).toEqual([]);
  const login = await call("POST", "/v1/auth/login", { email, password: PASSWORD });
  expect(login.status).toBe(200);
  return login;
}

describe.skipIf(!uri)("two real accounts (MongoDB + Argon2id)", () => {
  beforeAll(async () => {
    configureMongoDns(parseDnsServers(process.env.MONGODB_DNS_SERVERS), { log: () => undefined });
    await mongoose.connect(uri!, { dbName: process.env.SCOPEPILOT_TEST_MONGODB_DB ?? "scopepilot_test", serverSelectionTimeoutMS: 15_000 });
    await ensureAuthIndexes();
    const auth = createAuthService({ store });
    const interpreter = { provider: "gemini" as const, model: "test", promptVersion: "test", interpret: async () => ({ status: "failed" as const, input: { findingCount: 1, issueGroupCount: 1, issueGroupsOmitted: 0 }, content: null, rejected: [], uninterpretedRefs: [], failure: { code: "AI_PROVIDER_ERROR", message: "Test provider." } }) };
    const app = createApi({ auth, interpreter: interpreter as never, validateTarget: async (url) => new URL(url) });
    server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (mongoose.connection.readyState !== 1) return;
    const db = mongoose.connection;
    const users = await db.collection("users").find({ email: { $in: [emailA, emailB] } }, { projection: { _id: 1 } }).toArray();
    const userIds = users.map((user) => user._id);
    for (const name of ["audits", "auditinterpretations", "proposals"]) await db.collection(name).deleteMany({ workspaceId: { $in: workspaces } });
    await db.collection("sessions").deleteMany({ userId: { $in: userIds } });
    await db.collection("workspace_memberships").deleteMany({ userId: { $in: userIds } });
    await db.collection("workspaces").deleteMany({ ownerUserId: { $in: userIds } });
    await db.collection("users").deleteMany({ _id: { $in: userIds } });
    await mongoose.disconnect();
  }, 60_000);

  it("isolates account A's audit, interpretation and proposal from account B, and keeps them across logout", { timeout: 120_000 }, async () => {
    // Account A: register → audit → interpretation → proposal → edit → logout.
    const registeredA = await registerAndSignIn("Owner", emailA);
    const a = signedIn(registeredA);
    const workspaceA = registeredA.body.workspace.id as string;
    workspaces.push(workspaceA);
    const stored = await mongoose.connection.collection("users").findOne({ email: emailA });
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(stored)).not.toContain(PASSWORD);

    const created = await call("POST", "/v1/audits", { url: "https://example.com/", mode: "quick", includeMobileChecks: true, includeAccessibilityChecks: true }, a);
    expect(created.status).toBe(202);
    const auditId = created.body.id as string;
    // Stand in for the worker: the audit record really lives in A's workspace.
    await mongoose.connection.collection("audits").updateOne({ _id: new Types.ObjectId(auditId) }, { $set: { status: "partial", result, completedAt: new Date() } });
    expect((await mongoose.connection.collection("audits").findOne({ _id: new Types.ObjectId(auditId) }))?.workspaceId).toBe(workspaceA);

    expect((await call("POST", `/v1/audits/${auditId}/interpretation`, {}, a)).status).toBe(200);
    const proposal = await call("POST", "/v1/proposals", { auditId, selections: [{ source: "finding", ref: "seo:f0" }] }, a);
    expect(proposal.status).toBe(201);
    const proposalId = proposal.body.proposal.id as string;
    const { id: _id, auditId: _a, auditUrl: _u, status: _s, revision: _r, opportunities, createdAt: _c, updatedAt: _up, ...content } = proposal.body.proposal;
    const update = { revision: 1, status: "draft", content: { ...content, title: "Owner's edited proposal" }, opportunityIds: opportunities.map((o: { id: string }) => o.id) };
    expect(await call("PUT", `/v1/proposals/${proposalId}`, update, a)).toMatchObject({ status: 200, body: { proposal: { revision: 2, title: "Owner's edited proposal" } } });
    expect((await call("POST", "/v1/auth/logout", undefined, a)).status).toBe(204);
    expect((await call("GET", "/v1/auth/session", undefined, a)).status).toBe(401);

    // Account B: empty workspace, and every attempt on A's IDs is a 404.
    // Registering with A's email answers exactly like a new email and changes nothing about A's account.
    const accountA = await mongoose.connection.collection("users").findOne({ email: emailA });
    const takeover = await call("POST", "/v1/auth/register", { name: "Intruder", email: emailA.toUpperCase(), password: "intruder password 123" });
    const freshB = await call("POST", "/v1/auth/register", { name: "Intruder", email: emailB, password: PASSWORD });
    expect(takeover.status).toBe(202);
    expect({ status: takeover.status, body: takeover.body, cookies: takeover.setCookie }).toEqual({ status: freshB.status, body: freshB.body, cookies: freshB.setCookie });
    expect(await mongoose.connection.collection("users").findOne({ email: emailA })).toEqual(accountA);
    expect((await call("POST", "/v1/auth/login", { email: emailA, password: "intruder password 123" })).status).toBe(401);
    const registeredB = await call("POST", "/v1/auth/login", { email: emailB, password: PASSWORD });
    expect(registeredB.status).toBe(200);
    const b = signedIn(registeredB);
    workspaces.push(registeredB.body.workspace.id);
    expect(registeredB.body.workspace.id).not.toBe(workspaceA);
    expect((await call("GET", "/v1/audits", undefined, b)).body).toEqual({ audits: [] });
    expect((await call("GET", "/v1/proposals", undefined, b)).body).toEqual({ proposals: [] });
    expect(await call("GET", `/v1/audits/${auditId}`, undefined, b)).toMatchObject({ status: 404, body: { error: "AUDIT_NOT_FOUND" } });
    expect((await call("GET", `/v1/audits/${auditId}/interpretation`, undefined, b)).status).toBe(404);
    expect((await call("POST", `/v1/audits/${auditId}/interpretation`, {}, b)).status).toBe(404);
    expect((await call("POST", "/v1/proposals", { auditId, selections: [{ source: "finding", ref: "seo:f0" }] }, b)).status).toBe(404);
    expect(await call("GET", `/v1/proposals/${proposalId}`, undefined, b)).toMatchObject({ status: 404, body: { error: "PROPOSAL_NOT_FOUND" } });
    expect((await call("PUT", `/v1/proposals/${proposalId}`, { ...update, revision: 2 }, b)).status).toBe(404);
    expect((await call("POST", `/v1/proposals/${proposalId}/draft`, {}, b)).status).toBe(404);
    expect((await call("GET", `/v1/proposals/${new Types.ObjectId().toHexString()}`, undefined, b)).body).toEqual((await call("GET", `/v1/proposals/${proposalId}`, undefined, b)).body);

    // Account A signs back in and finds everything unchanged by B's attempts.
    const relogin = await call("POST", "/v1/auth/login", { email: emailA.toUpperCase(), password: PASSWORD });
    expect(relogin.status).toBe(200);
    const a2 = signedIn(relogin);
    expect(a2.cookie).not.toBe(a.cookie);
    expect(relogin.body.workspace.id).toBe(workspaceA);
    expect((await call("GET", "/v1/audits", undefined, a2)).body.audits.map((audit: { id: string }) => audit.id)).toEqual([auditId]);
    expect(await call("GET", `/v1/audits/${auditId}/interpretation`, undefined, a2)).toMatchObject({ status: 200 });
    expect(await call("GET", `/v1/proposals/${proposalId}`, undefined, a2)).toMatchObject({ status: 200, body: { proposal: { revision: 2, title: "Owner's edited proposal", auditId } } });
  });

  it("keeps legacy development data invisible until it is explicitly claimed by one account", { timeout: 60_000 }, async () => {
    const legacy = await mongoose.connection.collection("audits").insertOne({ workspaceId: legacyWorkspace, input: { url: "https://legacy.example/", mode: "quick" }, status: "completed", createdAt: new Date(), updatedAt: new Date() });
    const legacyId = legacy.insertedId.toHexString();
    const a = signedIn(await call("POST", "/v1/auth/login", { email: emailA, password: PASSWORD }));
    const b = signedIn(await call("POST", "/v1/auth/login", { email: emailB, password: PASSWORD }));
    for (const client of [a, b]) expect((await call("GET", `/v1/audits/${legacyId}`, undefined, client)).status).toBe(404);

    const workspaceA = (await call("GET", "/v1/auth/session", undefined, a)).body.workspace.id as string;
    const dryRun = await claimLegacyWorkspaceData({ fromWorkspaceId: legacyWorkspace, toWorkspaceId: workspaceA, apply: false });
    expect(dryRun.counts.audits).toBe(1);
    expect((await call("GET", `/v1/audits/${legacyId}`, undefined, a)).status).toBe(404);

    await claimLegacyWorkspaceData({ fromWorkspaceId: legacyWorkspace, toWorkspaceId: workspaceA, apply: true });
    expect((await call("GET", `/v1/audits/${legacyId}`, undefined, a)).status).toBe(200);
    expect((await call("GET", `/v1/audits/${legacyId}`, undefined, b)).status).toBe(404);
  });
});
