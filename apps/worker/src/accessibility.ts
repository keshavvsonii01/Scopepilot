import { createRequire } from "node:module";
import { type AccessibilityPageInput, AXE_RULE_TAGS, MAX_NODES_PER_VIOLATION } from "@scopepilot/analysis/accessibility";
import type { Page } from "playwright";

const require = createRequire(import.meta.url);
const axeCore = require("axe-core") as { source: string };

export const AXE_PAGE_TIMEOUT_MS = 15_000;
const MAX_DEFERRED_CALLBACKS = 10_000;

const AXE_INJECT_SCRIPT = `${axeCore.source}\n;void 0;`;

/*
 * The crawler disables page JavaScript. DevTools evaluation still runs, but timer callbacks never fire, so axe.run()
 * would hang. While axe runs, timer APIs are temporarily replaced with microtask scheduling (bounded to avoid
 * runaway loops) and restored afterwards. Page scripts remain disabled throughout.
 */
const AXE_RUN_SCRIPT = `(async () => {
  const w = window;
  const engine = w.axe;
  if (!engine || typeof engine.run !== "function") throw new Error("axe-core is not available in the page.");
  const saved = { setTimeout: w.setTimeout, clearTimeout: w.clearTimeout, requestAnimationFrame: w.requestAnimationFrame, cancelAnimationFrame: w.cancelAnimationFrame, requestIdleCallback: w.requestIdleCallback, cancelIdleCallback: w.cancelIdleCallback };
  let nextId = 0;
  const cancelled = new Set();
  const defer = (callback, args) => { const id = ++nextId; if (id <= ${MAX_DEFERRED_CALLBACKS}) Promise.resolve().then(() => { if (!cancelled.has(id) && typeof callback === "function") callback(...args); }); return id; };
  const cancel = (id) => { cancelled.add(id); };
  w.setTimeout = (callback, _delay, ...args) => defer(callback, args);
  w.clearTimeout = cancel;
  w.requestAnimationFrame = (callback) => defer(callback, [performance.now()]);
  w.cancelAnimationFrame = cancel;
  w.requestIdleCallback = (callback) => defer(callback, [{ didTimeout: false, timeRemaining: () => 50 }]);
  w.cancelIdleCallback = cancel;
  try {
    const result = await engine.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_RULE_TAGS)} }, resultTypes: ["violations"], iframes: false, performanceTimer: false, xpath: false, ancestry: false });
    return {
      engineVersion: result.testEngine && result.testEngine.version || null,
      violations: result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, description: violation.description, help: violation.help, helpUrl: violation.helpUrl, tags: violation.tags, nodeCount: violation.nodes.length, nodes: violation.nodes.slice(0, ${MAX_NODES_PER_VIOLATION}).map((node) => ({ target: node.target, html: String(node.html || "").slice(0, 1000), failureSummary: node.failureSummary || null })) })),
      incompleteRuleIds: result.incomplete.map((rule) => rule.id),
      passedRuleCount: result.passes.length,
      inapplicableRuleCount: result.inapplicable.length,
    };
  } finally { Object.assign(w, saved); }
})()`;

export class AxeTimeoutError extends Error { constructor() { super("axe-core did not finish within the per-page time limit."); this.name = "AxeTimeoutError"; } }

export async function runAxe(page: Page, timeoutMs = AXE_PAGE_TIMEOUT_MS): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => { await page.evaluate(AXE_INJECT_SCRIPT); return page.evaluate(AXE_RUN_SCRIPT); })();
  work.catch(() => undefined);
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AxeTimeoutError()), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export interface AccessibilityCollectorOptions {
  enabled: boolean;
  /** Epoch ms after which no new axe run starts, so accessibility work cannot push the crawl past its job timeout. */
  deadline: number;
  timeoutMs?: number;
  run?: (page: Page, timeoutMs: number) => Promise<unknown>;
  now?: () => number;
}

/** Collects raw axe output for each page the crawler loads, reusing the crawler's page instead of navigating again. */
export function createAccessibilityCollector(options: AccessibilityCollectorOptions) {
  const pages: AccessibilityPageInput[] = [];
  const timeoutMs = options.timeoutMs ?? AXE_PAGE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const run = options.run ?? runAxe;
  return {
    pages,
    async afterExtract(page: Page, url: string): Promise<void> {
      if (!options.enabled) return;
      if (now() + timeoutMs > options.deadline) {
        pages.push({ url, status: "skipped", error: { code: "TIME_BUDGET_EXHAUSTED", message: "Accessibility checks were skipped for this page because the audit time budget was nearly exhausted." } });
        return;
      }
      try { pages.push({ url, status: "completed", raw: await run(page, timeoutMs) }); }
      catch (error) {
        pages.push({ url, status: "failed", error: error instanceof AxeTimeoutError ? { code: "AXE_TIMEOUT", message: error.message } : { code: "AXE_FAILED", message: "axe-core could not analyze this page." } });
      }
    },
  };
}
