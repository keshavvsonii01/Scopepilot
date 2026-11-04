/**
 * Opt-in MongoDB integration test. Runs only when SCOPEPILOT_TEST_MONGODB_URI is set, against the
 * database named by SCOPEPILOT_TEST_MONGODB_DB (default "scopepilot_test"). All created documents
 * are scoped to random workspace IDs and deleted afterwards.
 */
import type { ProposalContent } from "@scopepilot/contracts/proposal";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAudit, getAuditForWorkspace } from "../src/audits.js";
import { configureMongoDns, parseDnsServers } from "../src/dns.js";
import { createProposal, getProposalForWorkspace, listProposalsForWorkspace, updateProposal } from "../src/proposals.js";

const uri = process.env.SCOPEPILOT_TEST_MONGODB_URI;
const workspaceId = `test-${randomUUID()}`;
const otherWorkspace = `test-${randomUUID()}`;
const content: ProposalContent = {
  title: "Integration proposal",
  client: { businessName: "Acme", contactName: "", contactEmail: "", website: "https://example.com/" },
  overview: { text: "", origin: "user" },
  objectives: [],
  scope: { text: "", origin: "user" },
  deliverables: [],
  milestones: [],
  pricing: { currency: "USD", lineItems: [], paymentTerms: "" },
  terms: { text: "", origin: "user" },
};

describe.skipIf(!uri)("proposal persistence (MongoDB)", () => {
  beforeAll(async () => {
    configureMongoDns(parseDnsServers(process.env.MONGODB_DNS_SERVERS), { log: () => undefined });
    await mongoose.connect(uri!, { dbName: process.env.SCOPEPILOT_TEST_MONGODB_DB ?? "scopepilot_test", serverSelectionTimeoutMS: 10_000 });
  }, 30_000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 1) return;
    await mongoose.connection.collection("audits").deleteMany({ workspaceId });
    await mongoose.connection.collection("proposals").deleteMany({ workspaceId: { $in: [workspaceId, otherWorkspace] } });
    await mongoose.disconnect();
  }, 30_000);

  it("creates, lists, updates and isolates proposals without touching the audit", { timeout: 30_000 }, async () => {
    const audit = await createAudit({ workspaceId, url: "https://example.com/", mode: "quick", includeMobileChecks: true, includeAccessibilityChecks: true });
    const before = await getAuditForWorkspace(audit.id, workspaceId);
    const created = await createProposal({ workspaceId, auditId: audit.id, auditUrl: "https://example.com/", opportunities: [], content });
    expect(created).toMatchObject({ auditId: audit.id, status: "draft", revision: 1, title: "Integration proposal" });

    expect(await getProposalForWorkspace(created.id, otherWorkspace)).toBeNull();
    expect(await listProposalsForWorkspace(otherWorkspace)).toEqual([]);
    expect((await listProposalsForWorkspace(workspaceId, audit.id)).map((item) => item.id)).toEqual([created.id]);

    const result = await updateProposal({ id: created.id, workspaceId, revision: 1, status: "sent", opportunities: [], content: { ...content, title: "Edited" } });
    expect(result).toMatchObject({ kind: "updated", proposal: { revision: 2, status: "sent", title: "Edited" } });
    expect(await updateProposal({ id: created.id, workspaceId, revision: 1, status: "draft", opportunities: [], content })).toMatchObject({ kind: "conflict", current: { revision: 2 } });
    expect(await updateProposal({ id: created.id, workspaceId: otherWorkspace, revision: 2, status: "draft", opportunities: [], content })).toEqual({ kind: "not-found" });

    expect(await getAuditForWorkspace(audit.id, workspaceId)).toEqual(before);
  });
});
