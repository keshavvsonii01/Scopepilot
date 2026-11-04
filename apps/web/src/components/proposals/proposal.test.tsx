import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { initialProposalContent, resolveSelections, type OpportunitySelection, type Proposal, type ProposalSummary } from "@scopepilot/contracts/proposal";
import { AUDIT_ID, axeFinding, interpretation, lcpFinding, titleFinding } from "@/test/fixtures";
import { applyDraft, describeSelections, editorState, removeOpportunity, toUpdateInput } from "@/lib/proposal";
import { ProposalEditor } from "./proposal-editor";
import { ProposalList } from "./proposal-list";
import { ProposalPreview } from "./proposal-preview";
import { localValidationError } from "./proposal-studio";
import { SelectionTray } from "../report/selection-tray";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const findings = [titleFinding, lcpFinding, axeFinding];
const snapshot = { startedAt: interpretation().startedAt, content: interpretation().content };
let counter = 0;
const newId = () => `item-${++counter}`;

function proposal(selections: OpportunitySelection[] = [{ source: "finding", ref: titleFinding.id }, { source: "ai-issue", ref: "I1" }]): Proposal {
  const resolved = resolveSelections(selections, findings, snapshot);
  if (!resolved.ok) throw new Error(resolved.error);
  const content = initialProposalContent({ auditUrl: "https://shop.example.com/", opportunities: resolved.opportunities, newId });
  return { ...content, id: "6600a1b2c3d4e5f6a7b8c9d1", auditId: AUDIT_ID, auditUrl: "https://shop.example.com/", status: "draft", revision: 0, opportunities: resolved.opportunities, createdAt: "2026-11-04T09:00:00.000Z", updatedAt: "2026-11-04T09:00:00.000Z" };
}

describe("opportunity selection", () => {
  it("describes selected findings and AI items with their supporting audit evidence", () => {
    const items = describeSelections([{ source: "finding", ref: titleFinding.id }, { source: "ai-opportunity", ref: "O0" }], findings, snapshot);
    expect(items.map((item) => item.opportunity?.findingIds)).toEqual([[titleFinding.id], [axeFinding.id]]);
    const html = renderToStaticMarkup(<SelectionTray items={items} creating={false} error={null} existing={[]} onRemove={() => undefined} onClear={() => undefined} onCreate={() => undefined} />);
    const content = text(html);
    expect(content).toContain("2 selected");
    expect(content).toContain(titleFinding.title);
    expect(content).toContain("Accessibility remediation");
    expect(content).toContain(`${axeFinding.title} · critical · measured`);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Create proposal/);
  });

  it("flags selections that no longer match the audit and blocks creation", () => {
    const items = describeSelections([{ source: "ai-issue", ref: "I9" }, { source: "finding", ref: "seo:unknown" }], findings, snapshot);
    expect(items.every((item) => item.opportunity === null)).toBe(true);
    expect(describeSelections([{ source: "ai-issue", ref: "I1" }], findings, null)[0]!.opportunity).toBeNull();
    const html = renderToStaticMarkup(<SelectionTray items={items} creating={false} error="Finding x does not exist." existing={null} onRemove={() => undefined} onClear={() => undefined} onCreate={() => undefined} />);
    expect(text(html)).toContain("no longer matches this audit");
    expect(text(html)).toContain("Finding x does not exist.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Create proposal/);
  });

  it("shows an empty selection with creation disabled and links existing proposals", () => {
    const existing: ProposalSummary[] = [{ id: "6600a1b2c3d4e5f6a7b8c9d1", auditId: AUDIT_ID, title: "Shop fixes", businessName: "", status: "sent", opportunityCount: 2, currency: "USD", total: null, createdAt: "2026-11-04T09:00:00.000Z", updatedAt: "2026-11-04T09:00:00.000Z" }];
    const html = renderToStaticMarkup(<SelectionTray items={[]} creating={false} error={null} existing={existing} onRemove={() => undefined} onClear={() => undefined} onCreate={() => undefined} />);
    expect(text(html)).toContain("Nothing selected");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Create proposal/);
    expect(html).toContain('href="/workspace/proposals/6600a1b2c3d4e5f6a7b8c9d1"');
  });
});

describe("proposal editor state", () => {
  it("removing an opportunity unlinks it from deliverables and is sent as the kept list", () => {
    const current = proposal();
    const [first, second] = current.opportunities;
    const state = removeOpportunity(editorState(current), first!.id);
    expect(state.opportunityIds).toEqual([second!.id]);
    expect(state.content.deliverables.every((item) => !item.opportunityIds.includes(first!.id))).toBe(true);
    const input = toUpdateInput(current.revision, state);
    expect(input).toMatchObject({ revision: 0, opportunityIds: [second!.id], addSelections: [] });
  });

  it("applies AI drafts as labelled suggestions without overwriting user text", () => {
    const current = proposal();
    const base = { ...editorState(current).content, overview: { text: "My own overview", origin: "user" as const } };
    const next = applyDraft(base, {
      overview: "AI overview", scope: "AI scope", objectives: ["Restore page titles"],
      deliverables: [{ title: "Title fixes", description: "Add titles", opportunityIds: [current.opportunities[0]!.id] }],
      milestones: [{ title: "Fixes", description: "Ship fixes", duration: "1 week" }],
    }, newId);
    expect(next.overview).toEqual({ text: "My own overview", origin: "user" });
    expect(next.scope).toEqual({ text: "AI scope", origin: "ai-suggestion" });
    expect(next.objectives.at(-1)).toMatchObject({ text: "Restore page titles", origin: "ai-suggestion" });
    expect(next.milestones.at(-1)).toMatchObject({ duration: "1 week", targetDate: null, origin: "ai-suggestion" });
    expect(next.pricing).toEqual(base.pricing);
  });

  it("validates content locally with the shared contract before saving", () => {
    const state = editorState(proposal());
    expect(localValidationError(state)).toBeNull();
    expect(localValidationError({ ...state, content: { ...state.content, title: "  " } })).toMatch(/title is required/);
    expect(localValidationError({ ...state, content: { ...state.content, pricing: { ...state.content.pricing, currency: "US" } } })).toMatch(/currency/);
    expect(localValidationError({ ...state, content: { ...state.content, client: { ...state.content.client, contactEmail: "nope" } } })).toMatch(/contactEmail/);
  });
});

describe("ProposalEditor", () => {
  it("renders every section with origin labels, evidence and add controls", () => {
    const current = proposal();
    const html = renderToStaticMarkup(<ProposalEditor state={editorState(current)} opportunities={current.opportunities} onChange={() => undefined} />);
    const content = text(html);
    for (const section of ["Proposal details", "Client dossier", "Selected opportunities", "Overview & objectives", "Scope & deliverables", "Timeline & milestones", "Commercial terms"]) expect(content).toContain(section);
    for (const action of ["Add objective", "Add deliverable", "Add milestone", "Add line item"]) expect(content).toContain(action);
    expect(content).toContain("From audit finding");
    expect(content).toContain("AI-interpreted issue");
    expect(content).toContain("Supporting evidence (1)");
    expect(content).toContain(axeFinding.id);
    expect(content).toContain("ScopePilot never generates prices");
  });
});

describe("ProposalPreview", () => {
  it("renders the document with totals, evidence and AI suggestion labels", () => {
    const current = proposal();
    const content = {
      ...editorState(current).content,
      client: { ...current.client, businessName: "Shop Ltd" },
      milestones: [{ id: "m1", title: "Discovery", description: "", duration: "2 weeks", targetDate: null, origin: "ai-suggestion" as const }],
      pricing: { currency: "GBP", lineItems: [{ id: "p1", label: "Fixes", amount: 1200.5 }, { id: "p2", label: "QA", amount: 300 }, { id: "p3", label: "Later", amount: null }], paymentTerms: "50% upfront." },
    };
    const output = text(renderToStaticMarkup(<ProposalPreview content={content} opportunities={current.opportunities} status="draft" auditUrl={current.auditUrl} />));
    expect(output).toContain("Prepared for Shop Ltd");
    expect(output).toContain("£1,500.50");
    expect(output).toContain("Not set");
    expect(output).toContain("2 weeks (suggested estimate)");
    // The milestone and the deliverable seeded from the AI-interpreted issue are both unreviewed.
    expect(output).toContain("2 AI-suggested items have not been edited");
    expect(output).toContain(`Evidence: ${titleFinding.title} (https://shop.example.com/)`);
    expect(output).toContain("outcomes of the proposed work are not guaranteed");
  });

  it("renders honest empty states for missing content", () => {
    const current = proposal([]);
    const output = text(renderToStaticMarkup(<ProposalPreview content={editorState(current).content} opportunities={[]} status="draft" auditUrl={current.auditUrl} />));
    for (const empty of ["No overview yet.", "No objectives yet.", "No opportunities selected.", "No deliverables yet.", "No milestones yet.", "No pricing entered.", "No terms entered.", "Business name not set"]) expect(output).toContain(empty);
    expect(output).not.toContain("Total");
  });
});

describe("ProposalList", () => {
  it("renders loading, error, empty and populated states", () => {
    expect(text(renderToStaticMarkup(<ProposalList proposals={[]} state="loading" />))).toContain("Loading proposals");
    expect(text(renderToStaticMarkup(<ProposalList proposals={[]} state="error" errorMessage="Store unavailable" onRetry={() => undefined} />))).toContain("Store unavailable");
    expect(text(renderToStaticMarkup(<ProposalList proposals={[]} />))).toContain("Proposals start from audit evidence.");
    const html = renderToStaticMarkup(<ProposalList proposals={[{ id: "6600a1b2c3d4e5f6a7b8c9d1", auditId: AUDIT_ID, title: "Shop fixes", businessName: "Shop Ltd", status: "accepted", opportunityCount: 3, currency: "USD", total: 2500, createdAt: "2026-11-04T09:00:00.000Z", updatedAt: "2026-11-04T09:00:00.000Z" }]} />);
    const output = text(html);
    expect(output).toContain("Shop fixes");
    expect(output).toContain("Accepted");
    expect(output).toContain("US$2,500.00");
    expect(html).toContain('href="/workspace/proposals/6600a1b2c3d4e5f6a7b8c9d1"');
  });
});
