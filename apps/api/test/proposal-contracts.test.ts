import { parseCreateProposalInput, parseProposalContent, proposalTotal, resolveSelections } from "@scopepilot/contracts/proposal";
import { describe, expect, it } from "vitest";

const content = {
  title: "P",
  client: { businessName: "", contactName: "", contactEmail: "", website: "" },
  overview: { text: "", origin: "user" },
  objectives: [],
  scope: { text: "", origin: "user" },
  deliverables: [],
  milestones: [],
  pricing: { currency: "usd", lineItems: [] as unknown[], paymentTerms: "" },
  terms: { text: "", origin: "user" },
};

describe("proposal contracts", () => {
  it("totals entered amounts in cents and treats empty pricing as unknown", () => {
    expect(proposalTotal({ lineItems: [{ id: "a", label: "", amount: 0.1 }, { id: "b", label: "", amount: 0.2 }] })).toBe(0.3);
    expect(proposalTotal({ lineItems: [{ id: "a", label: "", amount: null }] })).toBeNull();
    expect(proposalTotal({ lineItems: [{ id: "a", label: "", amount: 0 }] })).toBe(0);
  });

  it("normalises currency and accepts null or two-decimal amounts only", () => {
    expect(parseProposalContent({ ...content, pricing: { ...content.pricing, lineItems: [{ id: "a", label: "x", amount: null }, { id: "b", label: "y", amount: 19.99 }] } }).pricing).toEqual({ currency: "USD", lineItems: [{ id: "a", label: "x", amount: null }, { id: "b", label: "y", amount: 19.99 }], paymentTerms: "" });
    expect(() => parseProposalContent({ ...content, pricing: { ...content.pricing, lineItems: [{ id: "a", label: "x", amount: 1.234 }] } })).toThrow(/two decimal/);
    expect(() => parseProposalContent({ ...content, pricing: { ...content.pricing, lineItems: [{ id: "a", label: "x", amount: "100" }] } })).toThrow(/number/);
  });

  it("accepts only well-formed selections", () => {
    expect(parseCreateProposalInput({ auditId: "A".repeat(24), selections: [{ source: "finding", ref: "seo:x" }] })).toEqual({ ok: true, value: { auditId: "a".repeat(24), selections: [{ source: "finding", ref: "seo:x" }] } });
    expect(parseCreateProposalInput({ auditId: "a".repeat(24), selections: [{ source: "ai-issue", ref: "x" }] }).ok).toBe(false);
    expect(parseCreateProposalInput({ auditId: "a".repeat(24), selections: [{ source: "made-up", ref: "x" }] }).ok).toBe(false);
  });

  it("accepts real finding IDs, which join rule IDs and full URLs with '|'", () => {
    const ref = "axe.landmark-one-main|https://example.com/shop?page=2&sort=price#top";
    expect(parseCreateProposalInput({ auditId: "a".repeat(24), selections: [{ source: "finding", ref }] })).toMatchObject({ ok: true, value: { selections: [{ source: "finding", ref }] } });
    expect(parseCreateProposalInput({ auditId: "a".repeat(24), selections: [{ source: "finding", ref: "bad\nref" }] }).ok).toBe(false);
    expect(parseCreateProposalInput({ auditId: "a".repeat(24), selections: [{ source: "finding", ref: "x".repeat(2049) }] }).ok).toBe(false);
    const deliverable = { id: "d1", title: "t", description: "", origin: "user", opportunityIds: [`finding:${ref}`] };
    expect(parseProposalContent({ ...content, deliverables: [deliverable] }).deliverables[0]!.opportunityIds).toEqual([`finding:${ref}`]);
  });

  it("refuses AI selections without an interpretation", () => {
    expect(resolveSelections([{ source: "ai-issue", ref: "I1" }], [], null)).toMatchObject({ ok: false });
    expect(resolveSelections([{ source: "finding", ref: "x" }], [], null)).toMatchObject({ ok: false, ref: "finding:x" });
  });
});
