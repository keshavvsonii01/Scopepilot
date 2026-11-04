import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AuditFinding, SeoPageMeasurement } from "@scopepilot/contracts/analysis";
import type { InterpretationResponse } from "@scopepilot/contracts/interpretation";
import type { OpportunitySelection } from "@scopepilot/contracts/proposal";
import { AiInterpretationPanel, type AiInterpretationPanelProps } from "./ai-interpretation-panel";
import { AuditReportView } from "./audit-report-view";
import { imageCell, linkCell } from "./module-panels";
import { AuditList } from "../audit-list";
import { AUDIT_ID, analysis, audit, axeFinding, interpretation, lcpFinding, titleFinding } from "@/test/fixtures";
import { findingAnchor, formatBytes, formatMs, lighthouseSavingsRows, strategyCounterparts } from "@/lib/report";
import { loadStoredSelections, selectionControl, selectionStorageKey, storeSelections, toggleSelection } from "@/lib/proposal";

const seoPage: SeoPageMeasurement = analysis().modules.seo.measurements!.pages[0]!;

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function renderReport(...args: Parameters<typeof audit>) {
  const markup = renderToStaticMarkup(<AuditReportView audit={audit(...args)} />);
  return { markup, text: text(markup) };
}

function renderPanel(props: Partial<AiInterpretationPanelProps> & { response?: InterpretationResponse }) {
  const { response, ...rest } = props;
  const markup = renderToStaticMarkup(
    <AiInterpretationPanel state={response ? { kind: "loaded", response } : { kind: "loading" }} hasFindings requesting={false} onGenerate={() => undefined} {...rest} />,
  );
  return { markup, text: text(markup) };
}

describe("AuditReportView", () => {
  it("renders the real audit overview, module statuses and grouped findings with evidence and remediation", () => {
    const { markup, text: content } = renderReport();
    expect(content).toContain("shop.example.com");
    expect(content).toContain("3 Nov 2026, 10:00 UTC");
    for (const label of ["SEO measurements", "Performance measurements", "Accessibility measurements", "Analysis modules"]) expect(content).toContain(label);
    expect(content).toContain("PAGESPEED_REQUEST_FAILED: PageSpeed Insights returned HTTP 500.");

    const seoIndex = content.indexOf(titleFinding.title);
    const perfIndex = content.indexOf(lcpFinding.title);
    const axeIndex = content.indexOf(axeFinding.title);
    expect(seoIndex).toBeGreaterThan(-1);
    expect(seoIndex).toBeLessThan(perfIndex);
    expect(perfIndex).toBeLessThan(axeIndex);

    expect(content).toContain(titleFinding.remediation);
    expect(content).toContain("Observed Absent");
    expect(content).toContain(axeFinding.explanation);
    expect(content).toContain("<img class=\"hero\" src=\"/hero.jpg\">");
    expect(content).toContain("wcag2a, wcag111");
    expect(content).toContain("3 (showing 1)");
    expect(content).toContain("Rule-based");
    expect(content).toContain("Measured");
    expect(markup).toContain(`id="${findingAnchor(axeFinding.id)}"`);
    expect(content).toContain("No aggregate score is calculated");
  });

  it("shows missing metrics as Not reported and never fabricates values", () => {
    const { text: content } = renderReport();
    expect(content).toContain("Partial results");
    expect(content).toContain("42 / 100");
    expect(content).toContain("4.2 s");
    const desktop = content.slice(content.indexOf("Desktop"));
    expect(desktop).toContain("PAGESPEED_REQUEST_FAILED");
    expect(desktop.match(/Not reported/g)?.length).toBeGreaterThanOrEqual(6);
    expect(content).toContain("insufficient real-user data");
    expect(content).toContain("do not establish WCAG conformance");
  });

  it("renders unavailable and failed modules honestly without measurements", () => {
    const unavailableAnalysis = analysis({
      performance: { status: "unavailable", measurements: null, findingCount: 0, issues: [{ code: "PAGESPEED_NOT_CONFIGURED", message: "PAGESPEED_API_KEY is not set." }], notes: [] },
      accessibility: { status: "failed", measurements: null, findingCount: 0, issues: [{ code: "AXE_FAILED", message: "axe-core could not run." }], notes: [] },
    }, [titleFinding]);
    const { text: content } = renderReport({ result: { pages: audit().result!.pages, warnings: [], analysis: unavailableAnalysis } });
    expect(content).toContain("Not configured in this environment. No results are shown or estimated.");
    expect(content).toContain("No PageSpeed Insights measurements were recorded.");
    expect(content).toContain("No accessibility measurements were recorded.");
    expect(content).toContain("No Performance findings were produced");
    expect(content).toContain("PAGESPEED_NOT_CONFIGURED : PAGESPEED_API_KEY is not set.");
    expect(content).not.toContain("/ 100");
  });

  it("renders queued and failed audits without results", () => {
    const queued = renderReport({ status: "queued", startedAt: undefined, completedAt: undefined, result: undefined });
    expect(queued.text).toContain("Queued");
    expect(queued.text).not.toContain("Findings");

    const failed = renderReport({ status: "failed", result: undefined, failure: { code: "TARGET_UNREACHABLE", message: "The site did not respond." } });
    expect(failed.text).toContain("This audit could not be completed");
    expect(failed.text).toContain("TARGET_UNREACHABLE: The site did not respond.");
  });

  it("warns that the worker may be offline only once an audit has been queued for a while", () => {
    const createdAt = "2025-01-01T10:00:00.000Z";
    const queuedAudit = audit({ status: "queued", createdAt, startedAt: undefined, completedAt: undefined, result: undefined });
    const fresh = text(renderToStaticMarkup(<AuditReportView audit={queuedAudit} now={Date.parse(createdAt) + 30_000} />));
    expect(fresh).not.toContain("worker may be offline");
    const stale = text(renderToStaticMarkup(<AuditReportView audit={queuedAudit} now={Date.parse(createdAt) + 3 * 60_000} />));
    expect(stale).toContain("queued for 3 min");
    expect(stale).toContain("worker may be offline");
    expect(stale).toContain("within 15 minutes");

    const timedOut = renderReport({ status: "failed", result: undefined, failure: { code: "QUEUE_TIMEOUT", message: "No worker picked up this audit." } });
    expect(timedOut.text).toContain("QUEUE_TIMEOUT");
  });

  it("explains audits recorded before analysis modules existed", () => {
    const { text: content } = renderReport({ status: "completed", result: { pages: audit().result!.pages, warnings: [] } });
    expect(content).toContain("recorded before analysis modules existed");
  });

  it("links interpreted findings to their AI interpretation", () => {
    const markup = renderToStaticMarkup(<AuditReportView audit={audit()} interpretedIssues={interpretation().content!.issues} />);
    expect(markup).toContain("href=\"#ai-I1\"");
  });
});

describe("AiInterpretationPanel", () => {
  it("labels completed output as AI interpretation and links back to measured findings", () => {
    const { markup, text: content } = renderPanel({ response: { configured: true, interpretation: interpretation() } });
    expect(content).toContain("AI interpretation");
    expect(content).toContain("It is not a measurement");
    expect(content).toContain("Some images have no description for screen readers.");
    expect(content).toContain("Possible business relevance");
    expect(content).toContain("Suggested development services");
    expect(content).toContain("Desktop performance was not measured.");
    expect(markup).toContain(`href="#${findingAnchor(axeFinding.id)}"`);
    expect(markup).toContain("id=\"ai-I1\"");
    expect(content).toContain("gemini-3.8-flash");
    expect(content).toContain("Regenerate interpretation");
  });

  it("reports rejected and uninterpreted items for partial output", () => {
    const { text: content } = renderPanel({
      response: {
        configured: true,
        interpretation: interpretation({
          status: "partial",
          rejected: [{ path: "issues[1]", reason: "Mentions a URL that is not in the evidence." }],
          uninterpretedRefs: ["I2", "I3"],
          input: { findingCount: 30, issueGroupCount: 27, issueGroupsOmitted: 2 },
        }),
      },
    });
    expect(content).toContain("Partial interpretation");
    expect(content).toContain("1 AI statement was discarded");
    expect(content).toContain("issues[1] : Mentions a URL that is not in the evidence.");
    expect(content).toContain("Not interpreted: I2, I3");
    expect(content).toContain("2 lower-priority issue groups were not sent");
  });

  it("shows the not-configured state without a generate button", () => {
    const { text: content } = renderPanel({ response: { configured: false, interpretation: null } });
    expect(content).toContain("AI interpretation is not configured on this server");
    expect(content).not.toContain("Generate AI interpretation");
  });

  it("offers generation when configured and nothing exists yet", () => {
    expect(renderPanel({ response: { configured: true, interpretation: null } }).text).toContain("Generate AI interpretation");
  });

  it("shows provider failures with retry guidance", () => {
    const { text: content } = renderPanel({
      response: { configured: true, interpretation: interpretation({ status: "failed", content: null, failure: { code: "AI_RATE_LIMITED", message: "The AI provider rate limit was reached.", retryAfterSeconds: 30 } }) },
    });
    expect(content).toContain("AI interpretation failed (AI_RATE_LIMITED)");
    expect(content).toContain("retry in about 30 seconds");
    expect(content).toContain("Regenerate interpretation");
    expect(content).not.toContain("In plain language");
  });

  it("shows request errors, generating and loading states", () => {
    expect(renderPanel({ response: { configured: true, interpretation: null }, actionError: { code: "INTERPRETATION_IN_PROGRESS", message: "An interpretation is already being generated." } }).text).toContain("already being generated");
    expect(renderPanel({ response: { configured: true, interpretation: interpretation({ status: "generating", content: null, completedAt: undefined }) } }).text).toContain("Generating AI interpretation");
    expect(renderPanel({ response: { configured: true, interpretation: null }, requesting: true }).text).toContain("Generating AI interpretation");
    expect(renderPanel({}).text).toContain("Loading AI interpretation");
    expect(renderPanel({ state: { kind: "load-error", message: "The ScopePilot API could not be reached." } }).text).toContain("could not be reached");
  });

  it("does not offer interpretation when there are no findings", () => {
    const { text: content } = renderPanel({ response: { configured: true, interpretation: null }, hasFindings: false });
    expect(content).toContain("no measured findings to interpret");
    expect(content).not.toContain("Generate AI interpretation");
  });
});

describe("AuditList", () => {
  it("links each audit to its report and formats dates", () => {
    const markup = renderToStaticMarkup(<AuditList audits={[{ id: AUDIT_ID, domain: "shop.example.com", createdAt: "2026-11-03T10:00:00.000Z", status: "partial", findingCount: 3 }]} />);
    expect(markup).toContain(`href="/workspace/audits/${AUDIT_ID}"`);
    expect(text(markup)).toContain("3 Nov 2026, 10:00 UTC");
  });

  it("shows API errors", () => {
    expect(text(renderToStaticMarkup(<AuditList audits={[]} state="error" errorMessage="The ScopePilot API could not be reached." />))).toContain("could not be reached");
  });
});

describe("opportunity selection controls", () => {
  const selected = new Set([`finding:${titleFinding.id}`, "ai-issue:I1"]);
  const control = { isSelected: (selection: { source: string; ref: string }) => selected.has(`${selection.source}:${selection.ref}`), toggle: () => undefined };

  it("adds proposal toggles to findings and AI recommendations only when selection is enabled", () => {
    const markup = renderToStaticMarkup(<AuditReportView audit={audit()} selection={control} />);
    expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
    expect(markup).toContain(`aria-label="Remove from proposal: ${titleFinding.title}"`);
    expect(markup).toContain(`aria-label="Add to proposal: ${lcpFinding.title}"`);
    expect(renderReport().markup).not.toContain('type="checkbox"');

    const panel = renderPanel({ response: { configured: true, interpretation: interpretation() }, selection: control }).markup;
    expect(panel).toContain('aria-label="Remove from proposal: AI I1 Images must have alternative text"');
    expect(panel).toContain('aria-label="Add to proposal: AI service Accessibility remediation"');
  });

  it("keeps findings, expanded details, AI issues and AI services in sync while selecting and deselecting", () => {
    const report = audit();
    const findings = report.result!.analysis!.findings;
    const ai = interpretation();
    const snapshot = { startedAt: ai.startedAt, content: ai.content };
    const render = (selections: OpportunitySelection[]) => {
      const control = selectionControl(selections, findings, snapshot, () => undefined);
      const findingsMarkup = renderToStaticMarkup(<AuditReportView audit={report} selection={control} />);
      const panelMarkup = renderPanel({ response: { configured: true, interpretation: ai }, selection: control }).markup;
      return { findings: findingsMarkup, panel: panelMarkup, all: text(findingsMarkup + panelMarkup) };
    };

    let selections: OpportunitySelection[] = [];
    let view = render(selections);
    expect(view.all).not.toContain("Selected for proposal");
    expect(view.all).not.toContain("Already included");

    selections = toggleSelection(selections, { source: "finding", ref: axeFinding.id });
    view = render(selections);
    expect(view.findings).toContain(`aria-label="Remove from proposal: ${axeFinding.title}"`);
    expect(view.panel).toContain("Already included via a selected audit finding");
    expect(view.panel).toContain(`aria-label="Add to proposal: AI I1 ${axeFinding.title} (its findings are already included via a selected audit finding)"`);
    expect(view.findings).toContain(`aria-label="Add to proposal: ${lcpFinding.title}"`);

    selections = toggleSelection(selections, { source: "ai-issue", ref: "I1" });
    view = render(selections);
    expect(view.panel).toContain(`aria-label="Remove from proposal: AI I1 ${axeFinding.title}"`);
    expect(view.panel).toContain("Already included via a selected audit finding, AI I1");

    selections = toggleSelection(toggleSelection(selections, { source: "finding", ref: axeFinding.id }), { source: "ai-issue", ref: "I1" });
    expect(selections).toEqual([]);
    view = render(selections);
    expect(view.all).not.toContain("Selected for proposal");
    expect(view.all).not.toContain("Already included");
    expect(view.findings).toContain(`aria-label="Add to proposal: ${axeFinding.title}"`);
  });
});

describe("report measurement presentation", () => {
  it("formats Lighthouse savings, hiding unavailable values and keeping explicit zeros", () => {
    expect(formatBytes(54693)).toBe("53.4 KiB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MiB");
    expect(formatBytes(0)).toBe("0 B");
    for (const bad of [null, undefined, Number.NaN, -1, "54693", Infinity]) {
      expect(formatBytes(bad)).toBeNull();
      expect(formatMs(bad)).toBeNull();
    }
    expect(formatMs(300)).toBe("300 ms");
    expect(formatMs(0)).toBe("0 ms");
    expect(lighthouseSavingsRows({ estimatedSavings: { FCP: 300, LCP: 300 }, estimatedSavingsMs: 300 })).toEqual([
      { label: "Est. First Contentful Paint saving", value: "300 ms" },
      { label: "Est. Largest Contentful Paint saving", value: "300 ms" },
      { label: "Est. overall time saving", value: "300 ms" },
    ]);
    expect(lighthouseSavingsRows({ estimatedSavingsMs: 0, estimatedSavingsBytes: 54693 })).toEqual([
      { label: "Est. overall time saving", value: "0 ms" },
      { label: "Est. transfer size saving", value: "53.4 KiB" },
    ]);
    expect(lighthouseSavingsRows({ estimatedSavings: { LCP: null as unknown as number, CLS: 0.12 }, estimatedSavingsBytes: undefined })).toEqual([{ label: "Est. Cumulative Layout Shift saving", value: "0.12" }]);
    expect(lighthouseSavingsRows({})).toEqual([]);
  });

  it("presents strategy-specific Lighthouse findings as linked, separate measurements", () => {
    const base = { ...lcpFinding, category: "performance" as const, severity: "low" as const, title: "Reduce unused JavaScript", source: { tool: "pagespeed-insights" as const, ruleId: "lighthouse.unused-javascript" }, references: [] };
    const mobile: AuditFinding = { ...base, id: "performance:unused-js:mobile", severity: "medium", evidence: { kind: "lighthouse-audit", auditId: "unused-javascript", strategy: "mobile", lighthouseScore: 0.4, estimatedSavingsMs: 0, estimatedSavingsBytes: 54693 } };
    const desktop: AuditFinding = { ...base, id: "performance:unused-js:desktop", evidence: { kind: "lighthouse-audit", auditId: "unused-javascript", strategy: "desktop", lighthouseScore: 0.6, estimatedSavingsBytes: 50000 } };
    expect([...strategyCounterparts([mobile, desktop, lcpFinding]).keys()]).toEqual([mobile.id, desktop.id]);

    const { markup, text: content } = renderReport({ result: { ...audit().result!, analysis: analysis({}, [mobile, desktop]) } });
    expect(markup.match(/type="checkbox"/g)).toBeNull();
    expect(content).toContain("Lighthouse also reported this for desktop (low)");
    expect(content).toContain("Lighthouse also reported this for mobile (medium)");
    expect(markup).toContain(`href="#${findingAnchor(desktop.id)}"`);
    expect(content).toContain("Est. transfer size saving 53.4 KiB");
    expect(content).toContain("Est. transfer size saving 48.8 KiB");
    expect(content).not.toMatch(/\d+ bytes/);
    expect(content).not.toContain("Est. overall time saving 0 ms Est. overall");
  });

  it("labels internal link occurrences separately from distinct targets", () => {
    expect(linkCell({ ...seoPage, internalLinkCount: 1, internalLinkTargetCount: 0 })).toBe("1 link · 0 other pages");
    expect(linkCell({ ...seoPage, internalLinkCount: 5, internalLinkTargetCount: 2 })).toBe("5 links · 2 other pages");
    expect(linkCell({ ...seoPage, internalLinkCount: 0, internalLinkTargetCount: 0 })).toBe("0 links · 0 other pages");
    expect(linkCell({ ...seoPage, internalLinkCount: 3, internalLinkTargetCount: undefined })).toBe("3 links");
    expect(renderReport().text).toContain("distinct internal link targets (other than the linking page) checked");
  });

  it("never shows 0 / 0 as evidence that all images have alt text", () => {
    const none = text(renderToStaticMarkup(<>{imageCell({ ...seoPage, imageCount: 0, imagesMissingAlt: 0 })}</>));
    expect(none.trim()).toBe("No <img> in captured HTML");
    expect(imageCell({ ...seoPage, imageCount: 4, imagesMissingAlt: 4, imagesDecorative: 0 })).toBe("4 of 4 <img>");
    expect(imageCell({ ...seoPage, imageCount: 6, imagesMissingAlt: 2, imagesDecorative: 3 })).toBe("2 of 6 <img> · 3 decorative");
    const content = renderReport().text;
    expect(content).not.toContain("0 / 0");
    expect(content).toContain("the axe-core image-alt rule below can also accept other accessible names");
  });
});

describe("selection persistence across refresh", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  }

  it("round-trips selections per audit and clears the key when empty", () => {
    const storage = memoryStorage();
    storeSelections(storage, AUDIT_ID, [{ source: "finding", ref: "f1" }, { source: "ai-opportunity", ref: "0" }]);
    expect(loadStoredSelections(storage, AUDIT_ID)).toEqual([{ source: "finding", ref: "f1" }, { source: "ai-opportunity", ref: "0" }]);
    expect(loadStoredSelections(storage, "other-audit")).toEqual([]);
    storeSelections(storage, AUDIT_ID, []);
    expect(storage.data.has(selectionStorageKey(AUDIT_ID))).toBe(false);
  });

  it("ignores malformed, unknown-source and duplicate entries", () => {
    const storage = memoryStorage();
    storage.setItem(selectionStorageKey(AUDIT_ID), JSON.stringify([{ source: "finding", ref: "f1" }, { source: "finding", ref: "f1" }, { source: "invented", ref: "x" }, { source: "finding" }, null, "x"]));
    expect(loadStoredSelections(storage, AUDIT_ID)).toEqual([{ source: "finding", ref: "f1" }]);
    storage.setItem(selectionStorageKey(AUDIT_ID), "{not json");
    expect(loadStoredSelections(storage, AUDIT_ID)).toEqual([]);
    expect(loadStoredSelections(undefined, AUDIT_ID)).toEqual([]);
  });

  it("tolerates unavailable storage", () => {
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => undefined };
    expect(loadStoredSelections(throwing, AUDIT_ID)).toEqual([]);
    expect(() => storeSelections(throwing, AUDIT_ID, [{ source: "finding", ref: "f1" }])).not.toThrow();
  });
});