import type { ModuleRun, ModuleStatus } from "@scopepilot/contracts/analysis";
import type { AuditResult } from "@scopepilot/contracts/audit";
import { describe, expect, it } from "vitest";
import { QUEUED_AUDIT_TIMEOUT_MS } from "@scopepilot/contracts/audit";
import { QUEUE_TIMEOUT_FAILURE, deriveAuditStatus, staleQueuedFilter } from "../src/audits.js";

const run = (status: ModuleStatus): ModuleRun<null> => ({ status, measurements: null, issues: [], notes: [], findingCount: 0 });
const page = { url: "https://example.com/", title: "t", metaDescription: null, headings: [], canonical: null, robots: null, links: [], images: [], warnings: [] };

function result(statuses?: [ModuleStatus, ModuleStatus, ModuleStatus], overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    pages: [page],
    warnings: [],
    ...(statuses ? { analysis: { modules: { seo: run(statuses[0]), performance: run(statuses[1]), accessibility: run(statuses[2]) }, findings: [] } } : {}),
    ...overrides,
  } as AuditResult;
}

describe("deriveAuditStatus", () => {
  it("is completed when the crawl and every requested module completed", () => {
    expect(deriveAuditStatus(result(["completed", "completed", "completed"]))).toBe("completed");
  });

  it("ignores modules the user did not request", () => {
    expect(deriveAuditStatus(result(["completed", "completed", "skipped"]))).toBe("completed");
  });

  it.each(["partial", "failed", "unavailable"] as const)("is partial when a module is %s", (status) => {
    expect(deriveAuditStatus(result(["completed", status, "completed"]))).toBe("partial");
  });

  it("is partial when the crawl reported warnings", () => {
    expect(deriveAuditStatus(result(["completed", "completed", "completed"], { warnings: [{ code: "PAGE_LIMIT_REACHED", message: "limit" }] }))).toBe("partial");
    expect(deriveAuditStatus(result(undefined, { pages: [{ ...page, warnings: [{ code: "SCREENSHOT_FAILED", message: "x" }] }] }))).toBe("partial");
  });

  it("keeps pre-Phase-4 behavior for results without analysis", () => {
    expect(deriveAuditStatus(result())).toBe("completed");
  });
});

describe("queued audit timeout", () => {
  it("selects only queued audits older than the timeout and explains the failure", () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    expect(QUEUED_AUDIT_TIMEOUT_MS).toBe(15 * 60_000);
    expect(staleQueuedFilter(now)).toEqual({ status: "queued", createdAt: { $lt: new Date("2026-11-03T11:45:00.000Z") } });
    expect(staleQueuedFilter(now, 60_000).createdAt.$lt.toISOString()).toBe("2026-11-03T11:59:00.000Z");
    expect(QUEUE_TIMEOUT_FAILURE.code).toBe("QUEUE_TIMEOUT");
    expect(QUEUE_TIMEOUT_FAILURE.message).toContain("15 minutes");
  });
});