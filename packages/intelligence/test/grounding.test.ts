import { parseAiInterpretationOutput } from "@scopepilot/contracts/interpretation";
import { describe, expect, it } from "vitest";
import { buildCorpus, checkText } from "../src/grounding.js";

describe("checkText", () => {
  const corpus = buildCorpus({ value: 4200, displayValue: "4.2 s", score: 0.31, bytes: 153_600 }, ["https://example.test/about"]);

  it.each([
    "LCP was 4.2 s.",
    "LCP was 4200 ms.",
    "Lighthouse scored this 31%.",
    "About 150 KB could be saved.",
    "The page has multiple H1s.",
    "See https://example.test/about for the affected page.",
    "Automated tools cannot guarantee results.",
    "Passing these checks does not mean the site is WCAG compliant.",
  ])("accepts grounded text: %s", (text) => {
    expect(checkText(text, corpus)).toBeNull();
  });

  it.each([
    ["LCP was 2.1 s.", /measurement/],
    ["Users wait 12 seconds.", /measurement/],
    ["Visit https://example.test/pricing.", /URL/],
    ["This could cost €2,000 a month.", /monetary/],
    ["These fixes are guaranteed to work.", /guaranteed-outcome/],
    ["This will improve your conversion rate.", /guaranteed-outcome/],
    ["You will reach the top spot on Google.", /guaranteed-outcome/],
    ["After this the site meets WCAG 2.1.", /compliance/],
    ["The site becomes fully accessible.", /compliance/],
  ])("rejects %s", (text, reason) => {
    expect(checkText(text, corpus)).toMatch(reason);
  });
});

describe("parseAiInterpretationOutput", () => {
  it("drops structurally invalid items and keeps valid ones", () => {
    const result = parseAiInterpretationOutput({
      overview: "Summary.",
      issues: [{ ref: "I1", plainLanguage: "a", whyItMatters: "b", businessRelevance: "may c", recommendedImprovements: ["d"] }, { ref: "I2", plainLanguage: "x".repeat(5_000), whyItMatters: "b", businessRelevance: "c", recommendedImprovements: ["d"] }, "nope"],
      opportunities: [{ title: "T", summary: "S", refs: [], deliverables: ["D"] }],
      evidenceGaps: ["gap", 7],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issues.map((issue) => issue.ref)).toEqual(["I1"]);
    expect(result.value.opportunities).toEqual([]);
    expect(result.value.evidenceGaps).toEqual(["gap"]);
    expect(result.rejected.map((item) => item.path)).toEqual(["issues[1]", "issues[2]", "opportunities[0]", "evidenceGaps[1]"]);
  });

  it("fails on a malformed root", () => {
    expect(parseAiInterpretationOutput(null)).toEqual({ ok: false, reason: expect.any(String) });
    expect(parseAiInterpretationOutput({ overview: "x", issues: {} })).toMatchObject({ ok: false });
  });
});
