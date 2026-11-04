import type { Proposal } from "@scopepilot/contracts/proposal";
import { describe, expect, it } from "vitest";
import { formatAmount, pdfText, proposalPdfFilename, renderProposalPdf } from "../src/proposal-pdf.js";

/** Decodes the text drawn by the built-in fonts (hex strings inside TJ arrays) from an uncompressed PDF. */
function pdfStrings(pdf: Buffer): string {
  const source = pdf.toString("latin1");
  return [...source.matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map((match) => [...match[1]!.matchAll(/<([0-9a-fA-F]*)>/g)].map((hex) => Buffer.from(hex[1]!, "hex").toString("latin1")).join(""))
    .join("\n");
}

function pageCount(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g)?.length ?? 0;
}

const base: Proposal = {
  id: "0123456789abcdef01234567",
  auditId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  auditUrl: "https://shop.example.com/",
  status: "draft",
  revision: 3,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  title: "Website accessibility & performance",
  client: { businessName: "Acme Ltd", contactName: "Jane Doe", contactEmail: "jane@acme.test", website: "https://acme.test" },
  overview: { text: "We will address the issues found in the audit.", origin: "user" },
  objectives: [{ id: "o1", text: "Give every informative image a text alternative.", origin: "ai-suggestion" }],
  scope: { text: "Homepage templates only.", origin: "user" },
  opportunities: [{
    id: "op1", source: "finding", ref: "accessibility:image-alt", title: "Images must have alternative text", summary: "3 images lack alt text.", origin: "rule-based",
    category: "accessibility", severity: "critical", findingIds: ["accessibility:image-alt"],
    evidence: [{ findingId: "accessibility:image-alt", title: "Images must have alternative text", category: "accessibility", severity: "critical", basis: "measured", affectedUrl: "https://shop.example.com/" }],
  }],
  deliverables: [{ id: "d1", title: "Alt text pass", description: "Write alt text for informative images.", origin: "user", opportunityIds: ["op1"] }],
  milestones: [{ id: "m1", title: "Remediation", description: "", duration: "2 weeks", targetDate: "2026-12-01", origin: "ai-suggestion" }],
  pricing: { currency: "USD", lineItems: [{ id: "l1", label: "Accessibility fixes", amount: 1200 }, { id: "l2", label: "QA", amount: 300.5 }], paymentTerms: "50% upfront, 50% on completion." },
  terms: { text: "Work starts on signed acceptance.", origin: "user" },
};

describe("proposal PDF rendering", () => {
  it("produces a valid A4 PDF with every available section, header, footer and page numbers", async () => {
    const pdf = await renderProposalPdf(base, { compress: false });
    const source = pdf.toString("latin1");
    expect(source.startsWith("%PDF-1.")).toBe(true);
    expect(source.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(source).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    expect(source).toMatch(/\/Title \d+ 0 R/);
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(1);
    const text = pdfStrings(pdf);
    for (const expected of [
      "Website accessibility & performance", "Acme Ltd", "Jane Doe", "jane@acme.test", "https://acme.test", "https://shop.example.com/",
      "Project overview", "Objectives", "Issues and opportunities identified", "Scope of work", "Deliverables", "Timeline and milestones", "Investment", "Terms and conditions",
      "Give every informative image a text alternative.", "Evidence: Images must have alternative text (https://shop.example.com/)", "Addresses: Images must have alternative text",
      "2 weeks (suggested estimate)", "Target 2026-12-01", "$1,200.00", "$300.50", "Total", "$1,500.50", "Payment terms", "50% upfront, 50% on completion.",
      "Work starts on signed acceptance.", "AI-suggested draft based on audit evidence.", "SCOPEPILOT", `Page ${pages} of ${pages}`, "are not guaranteed.",
    ]) expect(text).toContain(expected);
    expect(text).toContain("PROPOSAL  ·  DRAFT  ·  2 NOVEMBER 2026");
  });

  it("omits empty optional sections and never fills them with invented content", async () => {
    const empty: Proposal = {
      ...base, title: "", client: { businessName: "", contactName: "", contactEmail: "", website: "" }, overview: { text: " ", origin: "user" }, objectives: [], opportunities: [],
      scope: { text: "", origin: "user" }, deliverables: [], milestones: [], pricing: { currency: "USD", lineItems: [], paymentTerms: "" }, terms: { text: "", origin: "user" },
    };
    const text = pdfStrings(await renderProposalPdf(empty, { compress: false }));
    expect(text).toContain("Untitled proposal");
    expect(text).toContain("https://shop.example.com/");
    for (const absent of ["Project overview", "Objectives", "Issues and opportunities", "Scope of work", "Deliverables", "Timeline", "Investment", "Payment terms", "Terms and conditions", "Prepared for", "Contact", "Total", "AI-suggested"]) {
      expect(text).not.toContain(absent);
    }
    expect(text).toContain("Page 1 of 1");
  });

  it("shows only payment terms when no line items exist, and qualifies the total when an amount is missing", async () => {
    const termsOnly = pdfStrings(await renderProposalPdf({ ...base, pricing: { currency: "EUR", lineItems: [], paymentTerms: "Net 30." } }, { compress: false }));
    expect(termsOnly).toContain("Investment");
    expect(termsOnly).toContain("Net 30.");
    expect(termsOnly).not.toContain("AMOUNT");
    const partial = pdfStrings(await renderProposalPdf({ ...base, pricing: { currency: "EUR", lineItems: [{ id: "a", label: "Design", amount: null }, { id: "b", label: "Build", amount: 2000 }], paymentTerms: "" } }, { compress: false }));
    expect(partial).toContain("Not entered");
    // € is WinAnsi 0x80, which the test decoder reads as U+0080.
    expect(partial).toContain("\u00802,000.00");
    expect(partial).toContain("Total of entered amounts");
    expect(partial).not.toContain("Payment terms");
  });

  it("breaks long proposals across pages with running headers and numbered footers", async () => {
    const long: Proposal = {
      ...base,
      deliverables: Array.from({ length: 40 }, (_, index) => ({ id: `d${index}`, title: `Deliverable ${index + 1}`, description: "Detailed description of the work. ".repeat(6), origin: "user" as const, opportunityIds: ["op1"] })),
      terms: { text: "Clause text. ".repeat(400), origin: "user" },
    };
    const pdf = await renderProposalPdf(long, { compress: false });
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(3);
    const text = pdfStrings(pdf);
    for (let page = 1; page <= pages; page += 1) expect(text).toContain(`Page ${page} of ${pages}`);
    expect(text.match(/SCOPEPILOT/g)).toHaveLength(pages);
    expect(text).toContain("Deliverable 40");
    expect((await renderProposalPdf(long)).length).toBeLessThan(pdf.length);
  });

  it("does not modify the proposal it renders", async () => {
    const copy = structuredClone(base);
    await renderProposalPdf(copy);
    expect(copy).toEqual(base);
  });

  it("sanitises text for the built-in fonts and formats amounts", () => {
    expect(pdfText("Smart “quotes” – café €5\u0000\u200B")).toBe("Smart “quotes” – café €5");
    expect(pdfText("日本 🚀")).toBe("?? ?");
    expect(pdfText("a\r\nb")).toBe("a\nb");
    expect(formatAmount(null, "USD")).toBe("Not entered");
    expect(formatAmount(Number.NaN, "USD")).toBe("Not entered");
    expect(formatAmount(0, "USD")).toBe("$0.00");
    expect(formatAmount(10, "XX1")).toBe("10.00 XX1");
  });

  it("builds safe ASCII filenames", () => {
    expect(proposalPdfFilename({ id: base.id, title: "Café Redesign — Q1 \"2027\"" })).toBe("scopepilot-proposal-cafe-redesign-q1-2027.pdf");
    expect(proposalPdfFilename({ id: base.id, title: "../../etc/passwd\r\nX-Header: 1" })).toBe("scopepilot-proposal-etc-passwd-x-header-1.pdf");
    expect(proposalPdfFilename({ id: base.id, title: "日本語" })).toBe(`scopepilot-proposal-${base.id}.pdf`);
    expect(proposalPdfFilename({ id: base.id, title: "a".repeat(200) })).toMatch(/^scopepilot-proposal-a{60}\.pdf$/);
    for (const title of ["\"; filename=evil.exe", "a/b\\c", ""]) expect(proposalPdfFilename({ id: base.id, title })).toMatch(/^scopepilot-proposal-[a-z0-9-]+\.pdf$/);
  });
});
