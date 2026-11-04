/**
 * Opt-in MongoDB integration test. Runs only when SCOPEPILOT_TEST_MONGODB_URI is set, against the
 * database named by SCOPEPILOT_TEST_MONGODB_DB (default "scopepilot_test"). All created documents
 * are scoped to a random workspace ID and deleted afterwards.
 */
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAudit, getAuditForWorkspace, listAuditsForWorkspace } from "../src/audits.js";
import { configureMongoDns, parseDnsServers } from "../src/dns.js";
import { beginInterpretation, completeInterpretation, getInterpretationForWorkspace } from "../src/interpretations.js";

const uri = process.env.SCOPEPILOT_TEST_MONGODB_URI;
const workspaceId = `test-${randomUUID()}`;
const attempt = (auditId: string) => ({ auditId, workspaceId, provider: "gemini" as const, model: "gemini-test", promptVersion: "test" });

describe.skipIf(!uri)("interpretation persistence (MongoDB)", () => {
  beforeAll(async () => {
    configureMongoDns(parseDnsServers(process.env.MONGODB_DNS_SERVERS), { log: () => undefined });
    await mongoose.connect(uri!, { dbName: process.env.SCOPEPILOT_TEST_MONGODB_DB ?? "scopepilot_test", serverSelectionTimeoutMS: 10_000 });
  }, 30_000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 1) return;
    await mongoose.connection.collection("audits").deleteMany({ workspaceId });
    await mongoose.connection.collection("auditinterpretations").deleteMany({ workspaceId });
    await mongoose.disconnect();
  }, 30_000);

  it("persists and retrieves interpretations without touching the audit", { timeout: 30_000 }, async () => {
    const audit = await createAudit({ workspaceId, url: "https://example.com/", mode: "quick", includeMobileChecks: true, includeAccessibilityChecks: true });
    expect(await listAuditsForWorkspace(workspaceId)).toEqual([{ id: audit.id, domain: "example.com", createdAt: audit.createdAt, status: "queued" }]);
    const before = await getAuditForWorkspace(audit.id, workspaceId);

    const attemptId = await beginInterpretation(attempt(audit.id));
    expect(attemptId).toEqual(expect.any(String));
    expect(await beginInterpretation(attempt(audit.id))).toBeNull();
    expect(await getInterpretationForWorkspace(audit.id, workspaceId)).toMatchObject({ status: "generating", content: null });
    expect(await getInterpretationForWorkspace(audit.id, "other-workspace")).toBeNull();

    const outcome = {
      status: "partial" as const,
      input: { findingCount: 2, issueGroupCount: 2, issueGroupsOmitted: 0 },
      content: { overview: "o", issues: [], opportunities: [], evidenceGaps: [] },
      rejected: [{ path: "issues[1]", reason: "r" }],
      uninterpretedRefs: ["I2"],
    };
    expect(await completeInterpretation(audit.id, "stale-attempt", outcome)).toBeNull();
    const stored = await completeInterpretation(audit.id, attemptId!, outcome);
    expect(stored).toMatchObject({ auditId: audit.id, status: "partial", content: outcome.content, rejected: outcome.rejected, uninterpretedRefs: ["I2"], input: outcome.input });
    expect(await getInterpretationForWorkspace(audit.id, workspaceId)).toEqual(stored);
    expect(await getAuditForWorkspace(audit.id, workspaceId)).toEqual(before);

    const retry = await beginInterpretation(attempt(audit.id));
    expect(retry).not.toBe(attemptId);
    const failed = await completeInterpretation(audit.id, retry!, { ...outcome, status: "failed", content: null, rejected: [], uninterpretedRefs: [], failure: { code: "AI_TIMEOUT", message: "t" } });
    expect(failed).toMatchObject({ status: "failed", content: null, failure: { code: "AI_TIMEOUT" } });
  });
});
