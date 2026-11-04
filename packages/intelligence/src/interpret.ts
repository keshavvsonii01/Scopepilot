import type { AuditAnalysis } from "@scopepilot/contracts/analysis";
import {
  parseAiInterpretationOutput,
  type InterpretationContent,
  type InterpretationFailureCode,
  type InterpretationInputSummary,
  type InterpretationRejection,
} from "@scopepilot/contracts/interpretation";
import { AiProviderError, type AiProvider } from "./gemini.js";
import { buildCorpus, groundInterpretation, groupCorpus, mergeCorpora } from "./grounding.js";
import { auditCoverage, buildIssueGroups, moduleContext } from "./issues.js";
import { buildUserPrompt, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION } from "./prompt.js";

export const DEFAULT_MAX_ISSUE_GROUPS = 25;

export interface InterpretationOutcome {
  status: "completed" | "partial" | "failed";
  input: InterpretationInputSummary;
  content: InterpretationContent | null;
  rejected: InterpretationRejection[];
  uninterpretedRefs: string[];
  failure?: { code: InterpretationFailureCode; message: string; retryAfterSeconds?: number };
}

export interface InterpretAuditOptions {
  analysis: AuditAnalysis;
  rootUrl: string;
  provider: AiProvider;
  signal?: AbortSignal;
  maxIssueGroups?: number;
}

function failed(input: InterpretationInputSummary, code: InterpretationFailureCode, message: string, extra: Partial<InterpretationOutcome> = {}, retryAfterSeconds?: number): InterpretationOutcome {
  return { status: "failed", input, content: null, rejected: [], uninterpretedRefs: [], ...extra, failure: { code, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) } };
}

function parseJson(text: string): unknown {
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(unfenced);
}

/**
 * Asks the provider to interpret verified findings, then validates structure and grounding.
 * Never throws: provider and validation failures are returned as a `failed` outcome.
 */
export async function interpretAudit({ analysis, rootUrl, provider, signal, maxIssueGroups = DEFAULT_MAX_ISSUE_GROUPS }: InterpretAuditOptions): Promise<InterpretationOutcome> {
  const { groups, omitted } = buildIssueGroups(analysis.findings, maxIssueGroups);
  const input: InterpretationInputSummary = { findingCount: analysis.findings.length, issueGroupCount: groups.length, issueGroupsOmitted: omitted };
  if (groups.length === 0) return failed(input, "NO_FINDINGS", "This audit has no findings to interpret.");

  let text: string;
  try {
    text = await provider.generate({ system: SYSTEM_INSTRUCTION, user: buildUserPrompt({ rootUrl, analysis, groups, issueGroupsOmitted: omitted }), responseSchema: RESPONSE_SCHEMA }, signal);
  } catch (error) {
    if (error instanceof AiProviderError) return failed(input, error.code, error.message, {}, error.retryAfterSeconds);
    return failed(input, "AI_PROVIDER_ERROR", "The AI provider failed unexpectedly.");
  }

  let raw: unknown;
  try { raw = parseJson(text); }
  catch { return failed(input, "AI_INVALID_OUTPUT", "The AI response was not valid JSON."); }

  const parsed = parseAiInterpretationOutput(raw);
  if (!parsed.ok) return failed(input, "AI_INVALID_OUTPUT", parsed.reason);

  const corpora = new Map(groups.map((group) => [group.ref, groupCorpus(group, rootUrl)]));
  const coverage = auditCoverage(analysis);
  const globalCorpus = mergeCorpora([...corpora.values(), buildCorpus(moduleContext(analysis), coverage, rootUrl, analysis.findings.length, omitted)]);
  const grounded = groundInterpretation(parsed.value, groups, corpora, globalCorpus, coverage);
  const rejected = [...parsed.rejected, ...grounded.rejected];

  if (grounded.content.issues.length === 0) {
    return failed(input, "AI_INVALID_OUTPUT", "No AI issue interpretation passed validation against the supplied evidence.", { rejected, uninterpretedRefs: grounded.uninterpretedRefs });
  }
  const complete = rejected.length === 0 && grounded.uninterpretedRefs.length === 0;
  return { status: complete ? "completed" : "partial", input, content: grounded.content, rejected, uninterpretedRefs: grounded.uninterpretedRefs };
}
