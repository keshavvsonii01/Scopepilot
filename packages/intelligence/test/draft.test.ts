import { evidenceReference, type ProposalOpportunity } from "@scopepilot/contracts/proposal";
import { describe, expect, it } from "vitest";
import { draftProposal } from "../src/draft.js";
import { AiProviderError, type AiProvider } from "../src/gemini.js";
import { altFinding, contrastFinding, lcpFinding, ROOT } from "./fixtures.js";

function provider(output: unknown): AiProvider & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  return { name: "gemini", model: "gemini-test", calls, async generate(request) { calls.push(request); return typeof output === "string" ? output : JSON.stringify(output); } };
}

function failing(error: unknown): AiProvider {
  return { name: "gemini", model: "gemini-test", async generate() { throw error; } };
}

const opportunities: ProposalOpportunity[] = [
  { id: `finding:${lcpFinding.id}`, source: "finding", ref: lcpFinding.id, title: lcpFinding.title, summary: lcpFinding.remediation, origin: "rule-based", category: "performance", severity: "high", findingIds: [lcpFinding.id], evidence: [evidenceReference(lcpFinding)] },
  { id: "ai-opportunity:O0@2026-11-20T10:00:00.000Z", source: "ai-opportunity", ref: "O0", title: "Accessibility and image fixes", summary: "Fix contrast and alt text.", origin: "ai-suggestion", category: null, severity: "high", findingIds: [contrastFinding.id, altFinding.id], evidence: [evidenceReference(contrastFinding), evidenceReference(altFinding)], interpretationStartedAt: "2026-11-20T10:00:00.000Z" },
];
const client = { businessName: "Acme", contactName: "", contactEmail: "", website: ROOT };
const base = { auditUrl: ROOT, client, opportunities, findings: [lcpFinding, contrastFinding, altFinding] };

const valid = {
  overview: "This project addresses a slow main content load of 4.2 s and accessibility issues found by automated checks. Improvements may help visitors.",
  objectives: ["Reduce the Largest Contentful Paint on mobile", "Improve text contrast and image alternatives"],
  scope: "Front-end performance and accessibility fixes for the audited pages only.",
  deliverables: [
    { title: "LCP optimisation", description: "Optimise the hero element.", opportunityIds: ["P1"] },
    { title: "Contrast and alt text", description: "Update colours and add alt text.", opportunityIds: ["P2"] },
  ],
  milestones: [{ title: "Performance fixes", description: "Ship LCP work.", duration: "1-2 weeks" }],
};

describe("draftProposal", () => {
  it("returns a grounded draft with opportunity refs mapped back to proposal IDs", async () => {
    const ai = provider(valid);
    const outcome = await draftProposal({ ...base, provider: ai });
    expect(outcome).toMatchObject({ ok: true, status: "completed", rejected: [] });
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.draft.deliverables.map((item) => item.opportunityIds)).toEqual([[opportunities[0]!.id], [opportunities[1]!.id]]);
    expect(outcome.draft.milestones[0]!.duration).toBe("1-2 weeks");
    expect(ai.calls[0]!.user).toContain("\"ref\":\"P2\"");
    expect(ai.calls[0]!.user).toContain("untrusted");
    expect(ai.calls[0]!.system).toContain("Never include prices");
  });

  it("drops fabricated measurements, prices, guarantees, unknown refs and foreign URLs", async () => {
    const outcome = await draftProposal({
      ...base,
      provider: provider({
        ...valid,
        overview: "The page takes 9.9 s to load.",
        objectives: ["This will increase your revenue", "Improve contrast", "Budget of $4,000"],
        scope: "See https://evil.example/ for details.",
        deliverables: [...valid.deliverables, { title: "SEO overhaul", description: "Rewrite all content.", opportunityIds: ["P9"] }],
        milestones: [{ title: "Launch", description: "Become WCAG 2.1 AA compliant.", duration: "2 weeks" }, ...valid.milestones],
      }),
    });
    expect(outcome).toMatchObject({ ok: true, status: "partial" });
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.draft.overview).toBe("");
    expect(outcome.draft.scope).toBe("");
    expect(outcome.draft.objectives).toEqual(["Improve contrast"]);
    expect(outcome.draft.deliverables).toHaveLength(2);
    expect(outcome.draft.milestones).toHaveLength(1);
    expect(outcome.rejected.map((item) => item.path).sort()).toEqual(["deliverables[2]", "milestones[0]", "objectives[0]", "objectives[2]", "overview", "scope"]);
  });

  it("fails when nothing survives validation", async () => {
    const outcome = await draftProposal({ ...base, provider: provider({ overview: "Costs $500.", objectives: [], scope: "", deliverables: [], milestones: [] }) });
    expect(outcome).toMatchObject({ ok: false, failure: { code: "AI_INVALID_OUTPUT" } });
  });

  it("rejects malformed JSON and structure", async () => {
    expect(await draftProposal({ ...base, provider: provider("not json") })).toMatchObject({ ok: false, failure: { code: "AI_INVALID_OUTPUT" } });
    expect(await draftProposal({ ...base, provider: provider({ overview: "x" }) })).toMatchObject({ ok: false, failure: { code: "AI_INVALID_OUTPUT" } });
  });

  it("reports provider failures, timeouts and rate limits", async () => {
    expect(await draftProposal({ ...base, provider: failing(new AiProviderError("AI_TIMEOUT", "slow")) })).toMatchObject({ ok: false, failure: { code: "AI_TIMEOUT" } });
    expect(await draftProposal({ ...base, provider: failing(new AiProviderError("AI_RATE_LIMITED", "quota", 30)) })).toMatchObject({ ok: false, failure: { code: "AI_RATE_LIMITED", retryAfterSeconds: 30 } });
    expect(await draftProposal({ ...base, provider: failing(new Error("boom")) })).toMatchObject({ ok: false, failure: { code: "AI_PROVIDER_ERROR" } });
  });

  it("refuses to draft without opportunities", async () => {
    const ai = provider(valid);
    expect(await draftProposal({ ...base, opportunities: [], provider: ai })).toMatchObject({ ok: false, failure: { code: "NO_FINDINGS" } });
    expect(ai.calls).toHaveLength(0);
  });
});
