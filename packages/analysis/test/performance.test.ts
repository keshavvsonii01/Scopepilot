import { describe, expect, it, vi } from "vitest";
import { PAGESPEED_ENDPOINT, parsePageSpeedResponse, performanceFindings, runPerformanceAnalysis } from "../src/performance.js";

const URL_UNDER_TEST = "https://example.com/";
const API_KEY = "test-key-SECRET-123";

function labAudit(numericValue: number, score: number, unit = "millisecond") {
  return { numericValue, numericUnit: unit, score, scoreDisplayMode: "numeric", displayValue: `${numericValue}` };
}

/** Minimal synthetic PageSpeed Insights v5 response with the fields ScopePilot reads. */
function psiBody(overrides: { audits?: Record<string, unknown>; loadingExperience?: unknown; originLoadingExperience?: unknown; runtimeError?: unknown } = {}) {
  return {
    loadingExperience: "loadingExperience" in overrides ? overrides.loadingExperience : {
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4200, category: "SLOW" },
        INTERACTION_TO_NEXT_PAINT: { percentile: 250, category: "AVERAGE" },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" },
      },
      overall_category: "SLOW",
    },
    originLoadingExperience: overrides.originLoadingExperience,
    lighthouseResult: {
      lighthouseVersion: "13.0.0",
      fetchTime: "2025-01-01T00:00:00.000Z",
      finalDisplayedUrl: URL_UNDER_TEST,
      runWarnings: [],
      ...(overrides.runtimeError ? { runtimeError: overrides.runtimeError } : {}),
      categories: { performance: { score: 0.42, auditRefs: [
        { id: "largest-contentful-paint", weight: 25 },
        { id: "render-blocking-insight", weight: 0 },
        { id: "passing-insight", weight: 0 },
      ] } },
      audits: overrides.audits ?? {
        "first-contentful-paint": labAudit(900, 0.98),
        "largest-contentful-paint": labAudit(5200, 0.3),
        "total-blocking-time": labAudit(400, 0.6),
        "cumulative-layout-shift": labAudit(0.02, 1, "unitless"),
        "speed-index": labAudit(1500, 0.95),
        "render-blocking-insight": { title: "Render-blocking requests", description: "Requests block rendering. [Learn more](https://developer.chrome.com/docs/insights/render-blocking)", score: 0, scoreDisplayMode: "metricSavings", metricSavings: { FCP: 600, LCP: 600 }, details: { overallSavingsMs: 600 } },
        "passing-insight": { title: "Passing", description: "fine", score: 1, scoreDisplayMode: "metricSavings", metricSavings: { LCP: 0 } },
      },
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("parsePageSpeedResponse", () => {
  it("captures lab metrics, Lighthouse's own score and field data", () => {
    const run = parsePageSpeedResponse("mobile", psiBody());
    expect(run.status).toBe("completed");
    expect(run.performanceScore).toBe(0.42);
    expect(run.lighthouseVersion).toBe("13.0.0");
    expect(run.lab["largest-contentful-paint"]).toEqual({ value: 5200, unit: "millisecond", displayValue: "5200", score: 0.3 });
    expect(run.unavailableLabMetrics).toEqual([]);
    expect(run.field).toMatchObject({ scope: "url", overallCategory: "SLOW" });
    expect(run.field?.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE).toEqual({ percentile: 5, value: 0.05, unit: "unitless", category: "FAST" });
  });

  it("records missing lab metrics instead of inventing them", () => {
    const body = psiBody({ audits: { "largest-contentful-paint": labAudit(2000, 0.8), "total-blocking-time": { scoreDisplayMode: "error", score: null } } });
    const run = parsePageSpeedResponse("desktop", body);
    expect(run.status).toBe("partial");
    expect(Object.keys(run.lab)).toEqual(["largest-contentful-paint"]);
    expect(run.unavailableLabMetrics).toEqual(["first-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]);
  });

  it("reports absent field data with a reason, and falls back to origin data when labeled", () => {
    const none = parsePageSpeedResponse("mobile", psiBody({ loadingExperience: { id: URL_UNDER_TEST } }));
    expect(none.field).toBeNull();
    expect(none.fieldUnavailableReason).toMatch(/not have enough real-user data/);

    const origin = parsePageSpeedResponse("mobile", psiBody({ loadingExperience: undefined, originLoadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 1800, category: "FAST" } } } }));
    expect(origin.field).toMatchObject({ scope: "origin", overallCategory: null });
  });

  it("treats a Lighthouse runtime error as a failed run with no metrics", () => {
    const run = parsePageSpeedResponse("mobile", psiBody({ runtimeError: { code: "NO_FCP", message: "The page did not paint any content." } }));
    expect(run.status).toBe("failed");
    expect(run.performanceScore).toBeNull();
    expect(run.lab).toEqual({});
    expect(run.error).toMatchObject({ code: "LIGHTHOUSE_RUNTIME_ERROR" });
    expect(performanceFindings(run, URL_UNDER_TEST)).toEqual([]);
  });

  it("rejects bodies without a Lighthouse result", () => {
    expect(parsePageSpeedResponse("mobile", { error: "nope" }).error?.code).toBe("PAGESPEED_INVALID_RESPONSE");
    expect(parsePageSpeedResponse("mobile", null).status).toBe("failed");
  });
});

describe("performanceFindings", () => {
  it("derives findings from Lighthouse scores, CrUX categories and insights", () => {
    const body = psiBody();
    const findings = performanceFindings(parsePageSpeedResponse("mobile", body), URL_UNDER_TEST, body);
    const byRule = Object.fromEntries(findings.map((finding) => [finding.source.ruleId, finding]));

    expect(Object.keys(byRule).sort()).toEqual([
      "crux.INTERACTION_TO_NEXT_PAINT", "crux.LARGEST_CONTENTFUL_PAINT_MS",
      "lighthouse.largest-contentful-paint", "lighthouse.render-blocking-insight", "lighthouse.total-blocking-time",
    ]);
    expect(byRule["lighthouse.largest-contentful-paint"]).toMatchObject({ severity: "high", basis: "measured", category: "performance", evidence: { kind: "metric", dataSource: "lab", value: 5200, lighthouseScore: 0.3 } });
    expect(byRule["lighthouse.total-blocking-time"]?.severity).toBe("medium");
    expect(byRule["crux.LARGEST_CONTENTFUL_PAINT_MS"]).toMatchObject({ severity: "high", evidence: { dataSource: "field", fieldCategory: "SLOW", fieldScope: "url" } });
    expect(byRule["crux.INTERACTION_TO_NEXT_PAINT"]?.severity).toBe("medium");
    expect(byRule["lighthouse.render-blocking-insight"]).toMatchObject({
      severity: "medium",
      evidence: { kind: "lighthouse-audit", estimatedSavingsMs: 600, estimatedSavings: { FCP: 600, LCP: 600 } },
      references: ["https://developer.chrome.com/docs/insights/render-blocking"],
    });
    expect(byRule["lighthouse.render-blocking-insight"]?.explanation).not.toContain("](");
  });
});

describe("runPerformanceAnalysis", () => {
  it("reports an explicit unavailable state without a key and never calls the API", async () => {
    const fetchMock = vi.fn();
    const result = await runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: undefined, strategies: ["mobile"], fetch: fetchMock });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.run).toMatchObject({ status: "unavailable", measurements: null, findingCount: 0 });
    expect(result.run.issues[0]?.code).toBe("PAGESPEED_NOT_CONFIGURED");
    expect(result.findings).toEqual([]);
  });

  it("requests each strategy server-side and stores raw measurements with findings", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, psiBody()));
    const result = await runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: API_KEY, strategies: ["mobile", "desktop"], fetch: fetchMock as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requested = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(`${requested.origin}${requested.pathname}`).toBe(PAGESPEED_ENDPOINT);
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({ url: URL_UNDER_TEST, strategy: "mobile", category: "PERFORMANCE", key: API_KEY });
    expect(result.run.status).toBe("completed");
    expect(result.run.measurements?.runs.map((run) => run.strategy)).toEqual(["mobile", "desktop"]);
    expect(result.findings.length).toBe(10);
    expect(result.run.findingCount).toBe(10);
  });

  it.each([
    [429, "PAGESPEED_RATE_LIMITED"],
    [500, "PAGESPEED_SERVICE_ERROR"],
    [400, "PAGESPEED_REQUEST_REJECTED"],
  ])("maps HTTP %i to %s and redacts the API key", async (status, code) => {
    const fetchMock = vi.fn(async () => jsonResponse(status, { error: { message: `Bad request for key=${API_KEY}` } }));
    const result = await runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: API_KEY, strategies: ["mobile"], fetch: fetchMock as typeof fetch });
    expect(result.run.status).toBe("failed");
    expect(result.findings).toEqual([]);
    expect(result.run.measurements?.runs[0]).toMatchObject({ status: "failed", performanceScore: null, lab: {} });
    expect(result.run.issues[0]?.code).toBe(code);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("reports network errors and timeouts without throwing", async () => {
    const network = await runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: API_KEY, strategies: ["mobile"], fetch: (async () => { throw new TypeError(`fetch failed ${API_KEY}`); }) as typeof fetch });
    expect(network.run.issues[0]?.code).toBe("PAGESPEED_NETWORK_ERROR");
    expect(JSON.stringify(network)).not.toContain(API_KEY);

    const hang = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const timedOut = await runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: API_KEY, strategies: ["mobile"], fetch: hang, timeoutMs: 20 });
    expect(timedOut.run.status).toBe("failed");
    expect(timedOut.run.issues[0]?.code).toBe("PAGESPEED_TIMEOUT");

    const controller = new AbortController();
    const pending = runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: API_KEY, strategies: ["mobile"], fetch: hang, signal: controller.signal });
    controller.abort();
    expect((await pending).run.issues[0]?.code).toBe("PAGESPEED_ABORTED");
  });

  it("reports invalid JSON as an invalid response", async () => {
    const result = await runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: API_KEY, strategies: ["mobile"], fetch: (async () => new Response("<html>", { status: 200 })) as typeof fetch });
    expect(result.run.issues[0]?.code).toBe("PAGESPEED_INVALID_RESPONSE");
  });

  it("is partial when one strategy fails and the other succeeds", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).searchParams.get("strategy") === "mobile" ? jsonResponse(500, {}) : jsonResponse(200, psiBody()));
    const result = await runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: API_KEY, strategies: ["mobile", "desktop"], fetch: fetchMock as typeof fetch });
    expect(result.run.status).toBe("partial");
    expect(result.run.issues.map((issue) => [issue.code, issue.strategy])).toEqual([["PAGESPEED_SERVICE_ERROR", "mobile"]]);
    expect(result.findings.every((finding) => finding.evidence.kind !== "metric" || finding.evidence.strategy === "desktop")).toBe(true);
  });

  it("is partial with an issue when Lighthouse omits metrics", async () => {
    const body = psiBody({ audits: { "largest-contentful-paint": labAudit(2000, 0.95) } });
    const result = await runPerformanceAnalysis({ url: URL_UNDER_TEST, apiKey: API_KEY, strategies: ["desktop"], fetch: (async () => jsonResponse(200, body)) as typeof fetch });
    expect(result.run.status).toBe("partial");
    expect(result.run.issues[0]).toMatchObject({ code: "LAB_METRICS_MISSING", strategy: "desktop" });
  });
});
