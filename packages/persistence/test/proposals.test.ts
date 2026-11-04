import type { ProposalContent } from "@scopepilot/contracts/proposal";
import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { toProposal, toProposalSummary, type StoredProposal } from "../src/proposals.js";

const content: ProposalContent = {
  title: "Proposal",
  client: { businessName: "Acme", contactName: "", contactEmail: "", website: "https://example.com/" },
  overview: { text: "", origin: "user" },
  objectives: [],
  scope: { text: "", origin: "user" },
  deliverables: [],
  milestones: [],
  pricing: { currency: "EUR", lineItems: [{ id: "l1", label: "Fixes", amount: 1200.1 }, { id: "l2", label: "Extra", amount: 0.2 }, { id: "l3", label: "TBD", amount: null }], paymentTerms: "" },
  terms: { text: "", origin: "user" },
};
const record: StoredProposal = {
  _id: new Types.ObjectId("65f0c0ffee0000000000abcd"),
  workspaceId: "w1",
  auditId: "a".repeat(24),
  auditUrl: "https://example.com/",
  status: "sent",
  revision: 3,
  opportunities: [],
  content,
  createdAt: new Date("2026-11-20T10:00:00.000Z"),
  updatedAt: new Date("2026-11-21T10:00:00.000Z"),
};

describe("proposal mapping", () => {
  it("returns a DTO without the workspace ID", () => {
    const proposal = toProposal(record);
    expect(proposal).toMatchObject({ id: "65f0c0ffee0000000000abcd", auditId: "a".repeat(24), status: "sent", revision: 3, title: "Proposal", createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z" });
    expect(proposal).not.toHaveProperty("workspaceId");
    expect(proposal).not.toHaveProperty("_id");
  });

  it("summarises totals from entered amounts only", () => {
    expect(toProposalSummary(record)).toEqual({ id: "65f0c0ffee0000000000abcd", auditId: "a".repeat(24), title: "Proposal", businessName: "Acme", status: "sent", opportunityCount: 0, currency: "EUR", total: 1200.3, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z" });
    expect(toProposalSummary({ ...record, content: { ...content, pricing: { ...content.pricing, lineItems: [] } } }).total).toBeNull();
  });
});
