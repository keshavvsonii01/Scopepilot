import type { AuditResult, AuditSubmission, PageInspection } from "@scopepilot/contracts/audit";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { runAudit } from "../src/audit-runner.js";
import type { inspectWebsite } from "../src/crawler.js";

const ROOT = "https://example.com/";
const resolver = { resolve: async () => ["93.184.216.34"] };
const submission: AuditSubmission = { url: ROOT, mode: "quick", includeMobileChecks: true, includeAccessibilityChecks: true, workspaceId: "ws_1" };

function inspection(url: string, overrides: Partial<PageInspection> = {}): PageInspection {
  return { url, title: "Example", metaDescription: "Example site.", headings: [{ level: 1, text: "Example" }], canonical: url, robots: null, links: [], images: [], httpStatus: 200, finalUrl: url, xRobotsTag: null, warnings: [], ...overrides };
}

/** Simulates the crawler: calls the analysis hook for each loaded page, then returns the crawl result. */
function fakeInspect(result: AuditResult): typeof inspectWebsite {
  return (async (_submission, _resolver, hooks = {}) => {
    for (const page of result.pages) if (!page.warnings.length) await hooks.afterExtract?.({} as Page, page.url);
    return result;
  }) as typeof inspectWebsite;
}

const axeOutput = { engineVersion: "4.14.0", violations: [{ id: "image-alt", impact: "critical", description: "d", help: "Images must have alternative text", helpUrl: "https://dequeuniversity.com/rules/axe/4.14/image-alt", tags: ["wcag2a", "wcag111"], nodeCount: 1, nodes: [{ target: ["img"], html: "<img>", failureSummary: null }] }], incompleteRuleIds: [], passedRuleCount: 5, inapplicableRuleCount: 5 };

describe("runAudit", () => {
  it("returns partial results when PageSpeed fails and axe fails on one page, keeping crawl, SEO and other findings", async () => {
    const crawl: AuditResult = {
      pages: [inspection(ROOT, { title: null }), inspection("https://example.com/about", { title: "About", metaDescription: "About us." }), inspection("https://example.com/slow", { warnings: [{ code: "PAGE_TIMEOUT", message: "timed out" }] })],
      warnings: [],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }));
    const runAxe = vi.fn(async (_page: Page) => { if (runAxe.mock.calls.length === 2) throw new Error("boom"); return axeOutput; });

    const result = await runAudit(submission, { pageSpeedApiKey: "k", resolver, fetch: fetchMock as typeof fetch, inspect: fakeInspect(crawl), runAxe });

    expect(result.pages).toBe(crawl.pages);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const { modules, findings } = result.analysis!;
    expect(modules.performance).toMatchObject({ status: "failed", measurements: { runs: [{ strategy: "mobile" }, { strategy: "desktop" }] } });
    expect(modules.performance.issues.map((issue) => issue.code)).toEqual(["PAGESPEED_RATE_LIMITED", "PAGESPEED_RATE_LIMITED"]);
    expect(modules.accessibility.status).toBe("partial");
    expect(modules.accessibility.issues).toEqual([expect.objectContaining({ code: "AXE_FAILED", url: "https://example.com/about" })]);
    expect(modules.seo.status).toBe("partial");
    expect(findings.map((finding) => finding.source.ruleId).sort()).toEqual(["image-alt", "seo.missing-title"]);
  });

  it("reports performance as unavailable without an API key and skips accessibility when not requested", async () => {
    const fetchMock = vi.fn();
    const runAxe = vi.fn();
    const result = await runAudit({ ...submission, includeAccessibilityChecks: false, includeMobileChecks: false }, { resolver, fetch: fetchMock as typeof fetch, inspect: fakeInspect({ pages: [inspection(ROOT)], warnings: [] }), runAxe });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runAxe).not.toHaveBeenCalled();
    expect(result.analysis!.modules.performance.status).toBe("unavailable");
    expect(result.analysis!.modules.accessibility.status).toBe("skipped");
    expect(result.analysis!.modules.seo.status).toBe("completed");
  });

  it("requests only the desktop strategy when mobile checks are off", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response("{}", { status: 500 }));
    await runAudit({ ...submission, includeMobileChecks: false }, { pageSpeedApiKey: "k", resolver, fetch: fetchMock as typeof fetch, inspect: fakeInspect({ pages: [inspection(ROOT)], warnings: [] }), runAxe: async () => axeOutput });
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("strategy"))).toEqual(["desktop"]);
  });

  it("still fails the audit when the crawl fails, and cancels PageSpeed", async () => {
    let aborted = false;
    const hang = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }))) as typeof fetch;
    const inspect = (async () => { throw new Error("Browser crashed"); }) as typeof inspectWebsite;
    await expect(runAudit(submission, { pageSpeedApiKey: "k", resolver, fetch: hang, inspect })).rejects.toThrow("Browser crashed");
    expect(aborted).toBe(true);
  });

  it("rejects private targets before any analysis request", async () => {
    const fetchMock = vi.fn();
    await expect(runAudit({ ...submission, url: "http://127.0.0.1/" }, { pageSpeedApiKey: "k", fetch: fetchMock as typeof fetch })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
