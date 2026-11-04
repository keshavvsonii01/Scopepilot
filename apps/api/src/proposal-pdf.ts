import PDFDocument from "pdfkit";
import { proposalTotal, type ContentOrigin, type Proposal, type ProposalStatus } from "@scopepilot/contracts/proposal";

/** ScopePilot editorial palette. Lime is used for fills only; it is too light for text on paper. */
const PAPER = "#F2F0EA";
const INK = "#171A19";
const LIME = "#8CFF69";
const MUTED = "#5C605D";
const RULE = "#C8C5BB";

const MARGIN = 56;
const TOP = 72;
const BOTTOM = 68;
const SERIF_BOLD = "Times-Bold";
const SANS = "Helvetica";
const SANS_BOLD = "Helvetica-Bold";
const SANS_ITALIC = "Helvetica-Oblique";

const STATUS_LABEL: Record<ProposalStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", rejected: "Rejected" };

/** Characters outside Latin-1 that the standard PDF fonts (WinAnsi) can still draw. */
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Makes user text safe for the built-in PDF fonts: strips control characters and replaces unsupported glyphs with "?". */
export function pdfText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2010-\u2012]/g, "-")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\n\t\u0020-\u007E\u00A0-\u00FF]/gu, (char) => (WIN_ANSI_EXTRA.includes(char) ? char : "?"));
}

/** ASCII-only download name derived from the proposal title; falls back to the proposal ID. */
export function proposalPdfFilename(proposal: Pick<Proposal, "id" | "title">): string {
  const slug = proposal.title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `scopepilot-proposal-${slug || proposal.id}.pdf`;
}

export function formatAmount(amount: number | null, currency: string): string {
  if (amount === null || !Number.isFinite(amount)) return "Not entered";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDate(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface ProposalPdfOptions {
  /** Disable stream compression (tests inspect the raw content). */
  compress?: boolean;
}

/** Renders a saved proposal to an A4 PDF. Only content present in the proposal is included; empty optional sections are omitted. */
export function renderProposalPdf(proposal: Proposal, options: ProposalPdfOptions = {}): Promise<Buffer> {
  const title = proposal.title.trim() || "Untitled proposal";
  const doc = new PDFDocument({
    size: "A4",
    autoFirstPage: false,
    bufferPages: true,
    compress: options.compress ?? true,
    margins: { top: TOP, bottom: BOTTOM, left: MARGIN, right: MARGIN },
    info: { Title: pdfText(title), Author: "ScopePilot", Creator: "ScopePilot", Subject: "Proposal" },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.on("pageAdded", () => {
    doc.save().rect(0, 0, doc.page.width, doc.page.height).fill(PAPER).restore();
  });

  const width = () => doc.page.width - MARGIN * 2;
  const limit = () => doc.page.height - BOTTOM;
  const ensure = (space: number) => {
    if (doc.y + space > limit()) doc.addPage();
  };
  const write = (text: string, opts: { font?: string; size?: number; color?: string; indent?: number; gap?: number; spacing?: number } = {}) => {
    const indent = opts.indent ?? 0;
    doc.font(opts.font ?? SANS).fontSize(opts.size ?? 10).fillColor(opts.color ?? INK)
      .text(pdfText(text), MARGIN + indent, doc.y, { width: width() - indent, lineGap: 2.5, characterSpacing: opts.spacing ?? 0 });
    doc.y += opts.gap ?? 4;
  };
  const height = (text: string, font: string, size: number, indent = 0) => doc.font(font).fontSize(size).heightOfString(pdfText(text), { width: width() - indent, lineGap: 2.5 });
  const aiNote = (origin: ContentOrigin, indent = 0) => {
    if (origin === "ai-suggestion") write("AI-suggested draft based on audit evidence.", { font: SANS_ITALIC, size: 8, color: MUTED, indent });
  };

  let sectionNumber = 0;
  const section = (heading: string, firstBlockHeight: number) => {
    doc.y += 16;
    ensure(34 + Math.min(firstBlockHeight, 140));
    sectionNumber += 1;
    const y = doc.y;
    doc.save().rect(MARGIN, y + 1, 24, 16).fill(LIME).restore();
    doc.font(SANS_BOLD).fontSize(8).fillColor(INK).text(String(sectionNumber).padStart(2, "0"), MARGIN, y + 5.5, { width: 24, align: "center", lineBreak: false });
    doc.font(SERIF_BOLD).fontSize(16).fillColor(INK).text(pdfText(heading), MARGIN + 34, y, { width: width() - 34, lineBreak: false });
    doc.save().moveTo(MARGIN, y + 24).lineTo(MARGIN + width(), y + 24).lineWidth(0.5).stroke(RULE).restore();
    doc.y = y + 34;
  };
  const rule = (y: number, color = RULE, weight = 0.5) => doc.save().moveTo(MARGIN, y).lineTo(MARGIN + width(), y).lineWidth(weight).stroke(color).restore();

  doc.addPage();

  // Title block
  const updated = formatDate(proposal.updatedAt);
  write(["Proposal", STATUS_LABEL[proposal.status], updated].filter(Boolean).join("  ·  ").toUpperCase(), { font: SANS_BOLD, size: 8, color: MUTED, spacing: 1.2, gap: 10 });
  write(title, { font: SERIF_BOLD, size: 30, gap: 10 });
  doc.save().rect(MARGIN, doc.y, 56, 5).fill(LIME).restore();
  doc.y += 22;

  const { client } = proposal;
  const contact = [client.contactName, client.contactEmail].map((value) => value.trim()).filter(Boolean).join("  ·  ");
  const meta: [string, string][] = [
    ["Prepared for", client.businessName.trim()],
    ["Contact", contact],
    ["Website", client.website.trim()],
    ["Audited site", proposal.auditUrl],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  for (const [label, value] of meta) {
    const y = doc.y;
    doc.font(SANS_BOLD).fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), MARGIN, y + 1.5, { width: 110, characterSpacing: 0.8, lineBreak: false });
    doc.font(SANS).fontSize(10).fillColor(INK).text(pdfText(value), MARGIN + 120, y, { width: width() - 120, lineGap: 2 });
    doc.y = Math.max(doc.y, y + 14) + 6;
  }

  if (proposal.overview.text.trim()) {
    section("Project overview", height(proposal.overview.text, SANS, 10));
    aiNote(proposal.overview.origin);
    write(proposal.overview.text);
  }

  const objectives = proposal.objectives.filter((item) => item.text.trim());
  if (objectives.length) {
    section("Objectives", height(objectives[0]!.text, SANS, 10, 22));
    objectives.forEach((item, index) => {
      ensure(height(item.text, SANS, 10, 22) + 4);
      const y = doc.y;
      doc.font(SANS_BOLD).fontSize(10).fillColor(MUTED).text(`${index + 1}.`, MARGIN, y, { width: 20, lineBreak: false });
      doc.y = y;
      write(item.text, { indent: 22, gap: 1 });
      aiNote(item.origin, 22);
      doc.y += 3;
    });
  }

  if (proposal.opportunities.length) {
    section("Issues and opportunities identified", 60);
    for (const item of proposal.opportunities) {
      const evidence = item.evidence.map((entry) => `${entry.title} (${entry.affectedUrl})`).join("; ");
      ensure(height(item.title, SERIF_BOLD, 12) + height(item.summary, SANS, 9.5) + 24);
      const tags = [capitalize(item.severity), item.category ? capitalize(item.category) : null, item.origin === "ai-suggestion" ? "AI interpretation" : null].filter(Boolean).join("  ·  ");
      write(item.title, { font: SERIF_BOLD, size: 12, gap: 1 });
      write(tags.toUpperCase(), { font: SANS_BOLD, size: 7, color: MUTED, spacing: 0.8, gap: 3 });
      if (item.summary.trim()) write(item.summary, { size: 9.5, gap: 2 });
      if (evidence) write(`Evidence: ${evidence}`, { size: 8, color: MUTED, gap: 2 });
      doc.y += 8;
    }
  }

  if (proposal.scope.text.trim()) {
    section("Scope of work", height(proposal.scope.text, SANS, 10));
    aiNote(proposal.scope.origin);
    write(proposal.scope.text);
  }

  const opportunityTitle = new Map(proposal.opportunities.map((item) => [item.id, item.title]));
  const deliverables = proposal.deliverables.filter((item) => item.title.trim() || item.description.trim());
  if (deliverables.length) {
    section("Deliverables", 50);
    deliverables.forEach((item, index) => {
      const addresses = item.opportunityIds.map((id) => opportunityTitle.get(id)).filter(Boolean).join("; ");
      ensure(height(item.title || "Deliverable", SANS_BOLD, 10.5, 30) + (item.description ? height(item.description, SANS, 9.5, 30) : 0) + 16);
      const y = doc.y;
      doc.font(SANS_BOLD).fontSize(9).fillColor(MUTED).text(String(index + 1).padStart(2, "0"), MARGIN, y + 1, { width: 24, lineBreak: false });
      doc.y = y;
      write(item.title.trim() || "Untitled deliverable", { font: SANS_BOLD, size: 10.5, indent: 30, gap: 1 });
      aiNote(item.origin, 30);
      if (item.description.trim()) write(item.description, { size: 9.5, indent: 30, gap: 1 });
      if (addresses) write(`Addresses: ${addresses}`, { size: 8, color: MUTED, indent: 30, gap: 1 });
      doc.y += 8;
    });
  }

  const milestones = proposal.milestones.filter((item) => item.title.trim() || item.description.trim() || item.duration.trim() || item.targetDate);
  if (milestones.length) {
    section("Timeline and milestones", 50);
    milestones.forEach((item, index) => {
      const timing = [item.duration.trim() ? `${item.duration.trim()}${item.origin === "ai-suggestion" ? " (suggested estimate)" : ""}` : null, item.targetDate ? `Target ${item.targetDate}` : null].filter(Boolean).join("  ·  ");
      ensure(height(item.title || "Milestone", SANS_BOLD, 10.5, 30) + (item.description ? height(item.description, SANS, 9.5, 30) : 0) + 24);
      const y = doc.y;
      doc.save().circle(MARGIN + 5, y + 6, 3.5).fill(index === 0 ? LIME : RULE).restore();
      doc.y = y;
      write(item.title.trim() || "Untitled milestone", { font: SANS_BOLD, size: 10.5, indent: 30, gap: 1 });
      aiNote(item.origin, 30);
      if (timing) write(timing, { font: SANS_BOLD, size: 8, color: MUTED, indent: 30, gap: 2 });
      if (item.description.trim()) write(item.description, { size: 9.5, indent: 30, gap: 1 });
      doc.y += 8;
    });
  }

  const { pricing } = proposal;
  const paymentTerms = pricing.paymentTerms.trim();
  if (pricing.lineItems.length || paymentTerms) {
    section("Investment", pricing.lineItems.length ? 60 : height(paymentTerms, SANS, 10));
    if (pricing.lineItems.length) {
      const amountWidth = 140;
      const labelWidth = width() - amountWidth - 12;
      const row = (label: string, amount: string, font: string, size: number, color = INK) => {
        const rowHeight = Math.max(doc.font(font).fontSize(size).heightOfString(pdfText(label), { width: labelWidth }), size + 2);
        ensure(rowHeight + 12);
        const y = doc.y;
        doc.font(font).fontSize(size).fillColor(color).text(pdfText(label), MARGIN, y, { width: labelWidth });
        doc.font(font).fontSize(size).fillColor(color).text(pdfText(amount), MARGIN + width() - amountWidth, y, { width: amountWidth, align: "right", lineBreak: false });
        doc.y = y + rowHeight + 6;
        return doc.y;
      };
      row("ITEM", `AMOUNT (${pricing.currency})`, SANS_BOLD, 7.5, MUTED);
      rule(doc.y - 2);
      for (const item of pricing.lineItems) {
        const end = row(item.label.trim() || "Unnamed item", formatAmount(item.amount, pricing.currency), SANS, 10);
        rule(end - 2);
      }
      const total = proposalTotal(pricing);
      if (total !== null) {
        rule(doc.y - 1, INK, 1);
        doc.y += 4;
        // Missing amounts are excluded from the sum, so say so rather than presenting a complete total.
        const label = pricing.lineItems.some((item) => item.amount === null) ? "Total of entered amounts" : "Total";
        row(label, formatAmount(total, pricing.currency), SANS_BOLD, 11);
      }
    }
    if (paymentTerms) {
      doc.y += 6;
      ensure(height(paymentTerms, SANS, 10) + 18);
      write("Payment terms", { font: SANS_BOLD, size: 10, gap: 2 });
      write(paymentTerms);
    }
  }

  if (proposal.terms.text.trim()) {
    section("Terms and conditions", height(proposal.terms.text, SANS, 9.5));
    aiNote(proposal.terms.origin);
    write(proposal.terms.text, { size: 9.5 });
  }

  doc.y += 18;
  const disclaimer = `Based on a ScopePilot audit of ${proposal.auditUrl}. Audit findings describe what was observed at the time of the audit; outcomes of the proposed work are not guaranteed.`;
  ensure(height(disclaimer, SANS_ITALIC, 8) + 8);
  write(disclaimer, { font: SANS_ITALIC, size: 8, color: MUTED });

  // Running header and footer, drawn once the total page count is known.
  const { start, count } = doc.bufferedPageRange();
  const footerLabel = client.businessName.trim() ? `Prepared for ${client.businessName.trim()}` : `Audit of ${proposal.auditUrl}`;
  for (let index = start; index < start + count; index += 1) {
    doc.switchToPage(index);
    doc.page.margins.bottom = 0;
    const pageHeight = doc.page.height;
    doc.save().rect(MARGIN, 34, 7, 7).fill(LIME).restore();
    doc.font(SANS_BOLD).fontSize(7.5).fillColor(INK).text("SCOPEPILOT", MARGIN + 12, 34.5, { characterSpacing: 1.2, lineBreak: false });
    if (index > start) doc.font(SANS).fontSize(7.5).fillColor(MUTED).text(pdfText(title), MARGIN + 120, 34.5, { width: width() - 120, align: "right", lineBreak: false, ellipsis: true, height: 10 });
    rule(48);
    rule(pageHeight - 46);
    doc.font(SANS).fontSize(7.5).fillColor(MUTED).text(pdfText(footerLabel), MARGIN, pageHeight - 38, { width: width() - 90, lineBreak: false, ellipsis: true, height: 10 });
    doc.font(SANS_BOLD).fontSize(7.5).fillColor(INK).text(`Page ${index - start + 1} of ${count}`, MARGIN + width() - 90, pageHeight - 38, { width: 90, align: "right", lineBreak: false });
  }

  doc.end();
  return finished;
}
