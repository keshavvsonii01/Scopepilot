import { existsSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AxeTimeoutError, createAccessibilityCollector, runAxe } from "../src/accessibility.js";
import { extractDocument } from "../src/crawler.js";
import { analyzeSeo } from "@scopepilot/analysis/seo";

const fakePage = {} as Page;

describe("createAccessibilityCollector", () => {
  it("does nothing when accessibility checks are disabled", async () => {
    let calls = 0;
    const collector = createAccessibilityCollector({ enabled: false, deadline: Number.MAX_SAFE_INTEGER, run: async () => { calls += 1; return {}; } });
    await collector.afterExtract(fakePage, "https://example.com/");
    expect(calls).toBe(0);
    expect(collector.pages).toEqual([]);
  });

  it("records raw output, timeouts and failures per page", async () => {
    const outcomes: Array<() => unknown> = [() => ({ violations: [] }), () => { throw new AxeTimeoutError(); }, () => { throw new Error("Execution context was destroyed"); }];
    const collector = createAccessibilityCollector({ enabled: true, deadline: Number.MAX_SAFE_INTEGER, run: async () => outcomes.shift()!() });
    for (const path of ["a", "b", "c"]) await collector.afterExtract(fakePage, `https://example.com/${path}`);
    expect(collector.pages).toEqual([
      { url: "https://example.com/a", status: "completed", raw: { violations: [] } },
      { url: "https://example.com/b", status: "failed", error: { code: "AXE_TIMEOUT", message: expect.any(String) } },
      { url: "https://example.com/c", status: "failed", error: { code: "AXE_FAILED", message: "axe-core could not analyze this page." } },
    ]);
  });

  it("skips pages when a run could exceed the time budget", async () => {
    let calls = 0;
    const collector = createAccessibilityCollector({ enabled: true, deadline: 10_000, timeoutMs: 5_000, now: () => 6_000, run: async () => { calls += 1; return {}; } });
    await collector.afterExtract(fakePage, "https://example.com/");
    expect(calls).toBe(0);
    expect(collector.pages[0]).toMatchObject({ status: "skipped", error: { code: "TIME_BUDGET_EXHAUSTED" } });
  });
});

const chromiumAvailable = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();

describe.skipIf(!chromiumAvailable)("runAxe in Chromium with JavaScript disabled", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });

  it("reports real violations without executing page scripts", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.setContent(`<!doctype html><html><head><title>t</title></head><body>
        <script>document.title = "script ran";</script>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
        <button></button>
      </body></html>`);
      const raw = await runAxe(page, 15_000) as { engineVersion: string; violations: Array<{ id: string; impact: string; tags: string[]; nodeCount: number }>; passedRuleCount: number };

      expect(raw.engineVersion).toMatch(/^4\./);
      const ids = raw.violations.map((violation) => violation.id);
      expect(ids).toEqual(expect.arrayContaining(["html-has-lang", "image-alt", "button-name"]));
      expect(raw.violations.find((violation) => violation.id === "image-alt")).toMatchObject({ impact: "critical", nodeCount: 1, tags: expect.arrayContaining(["wcag2a"]) });
      expect(raw.passedRuleCount).toBeGreaterThan(0);
      expect(await page.title()).toBe("t");
      expect(await page.evaluate("typeof window.setTimeout === 'function' && !String(window.setTimeout).includes('defer')")).toBe(true);
    } finally { await context.close(); }
  }, 30_000);

  it("extracts the same <img> elements that axe-core's image-alt rule flags, including ones without src", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      await page.setContent(`<!doctype html><html lang="en"><head><title>t</title></head><body><main>
        <img class="a"><img class="b">
        <img src="/x.png" alt="">
        <img src="/y.png" role="presentation">
        <img src="/z.png" alt="Chart">
      </main></body></html>`);
      const raw = await runAxe(page, 15_000) as { violations: Array<{ id: string; nodeCount: number }> };
      const { images } = await extractDocument(page);
      const seo = analyzeSeo({ rootUrl: "https://example.com/", pages: [{ url: "https://example.com/", title: "t", metaDescription: null, headings: [], canonical: null, robots: null, links: [], images, warnings: [] }] });
      const measured = seo.run.measurements!.pages[0]!;
      expect(images).toHaveLength(5);
      expect(measured).toMatchObject({ imageCount: 5, imagesMissingAlt: 2, imagesDecorative: 2 });
      expect(raw.violations.find((violation) => violation.id === "image-alt")?.nodeCount).toBe(measured.imagesMissingAlt);
    } finally { await context.close(); }
  }, 30_000);
});
