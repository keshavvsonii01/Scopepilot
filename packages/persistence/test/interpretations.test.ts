import { describe, expect, it } from "vitest";
import { toAuditSummary } from "../src/audits.js";
import { INTERPRETATION_STALE_MS, toInterpretation, type StoredInterpretation } from "../src/interpretations.js";

const startedAt = new Date("2026-11-20T10:00:00.000Z");
const base: StoredInterpretation = {
  auditId: "a1",
  workspaceId: "w1",
  attemptId: "t1",
  status: "generating",
  provider: "gemini",
  model: "gemini-test",
  promptVersion: "p",
  startedAt,
  content: null,
  rejected: [],
  uninterpretedRefs: [],
};

describe("toInterpretation", () => {
  it("reports an in-flight generation as generating", () => {
    const record = toInterpretation(base, new Date(startedAt.getTime() + 1_000));
    expect(record).toEqual({ auditId: "a1", status: "generating", provider: "gemini", model: "gemini-test", promptVersion: "p", startedAt: startedAt.toISOString(), content: null, rejected: [], uninterpretedRefs: [] });
    expect(record).not.toHaveProperty("workspaceId");
    expect(record).not.toHaveProperty("attemptId");
  });

  it("reports a stale generation as interrupted", () => {
    const record = toInterpretation(base, new Date(startedAt.getTime() + INTERPRETATION_STALE_MS + 1));
    expect(record.status).toBe("failed");
    expect(record.failure?.code).toBe("AI_GENERATION_INTERRUPTED");
  });

  it("returns stored content and failures unchanged", () => {
    const content = { overview: "o", issues: [], opportunities: [], evidenceGaps: ["g"] };
    const completedAt = new Date(startedAt.getTime() + 5_000);
    expect(toInterpretation({ ...base, status: "partial", completedAt, content, rejected: [{ path: "issues[0]", reason: "r" }], uninterpretedRefs: ["I2"] })).toMatchObject({ status: "partial", completedAt: completedAt.toISOString(), content, rejected: [{ path: "issues[0]", reason: "r" }], uninterpretedRefs: ["I2"] });
    expect(toInterpretation({ ...base, status: "failed", completedAt, failure: { code: "AI_RATE_LIMITED", message: "m", retryAfterSeconds: 5 } }).failure).toEqual({ code: "AI_RATE_LIMITED", message: "m", retryAfterSeconds: 5 });
  });
});

describe("toAuditSummary", () => {
  const createdAt = new Date("2026-11-20T09:00:00.000Z");

  it("derives the domain and finding count", () => {
    expect(toAuditSummary({ _id: "abc", input: { url: "https://www.example.com/path" }, status: "partial", createdAt, result: { analysis: { findings: [{}, {}] } } })).toEqual({ id: "abc", domain: "www.example.com", createdAt: createdAt.toISOString(), status: "partial", findingCount: 2 });
  });

  it("omits the finding count when analysis has not run", () => {
    expect(toAuditSummary({ _id: "abc", input: { url: "https://example.com/" }, status: "queued", createdAt })).not.toHaveProperty("findingCount");
  });
});
