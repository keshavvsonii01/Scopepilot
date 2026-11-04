import type {
  AiInterpretationOutput,
  InterpretationContent,
  InterpretationRejection,
  InterpretedIssue,
  InterpretedOpportunity,
} from "@scopepilot/contracts/interpretation";
import type { AuditCoverage, IssueGroup } from "./issues.js";

/** Numbers and URLs that the AI is allowed to cite for a given piece of text. */
export interface EvidenceCorpus {
  numbers: number[];
  urls: Set<string>;
}

const NUMBER_IN_TEXT = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/gi;
const MEASUREMENT_IN_TEXT = /(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(milliseconds?|ms|seconds?|secs?|s|percent|%|kib|kb|kilobytes?|mib|mb|megabytes?|bytes?|pixels?|px|characters?|chars?)(?![a-z])/gi;
const CURRENCY = /[$€£¥₹]\s?\d|\b\d[\d,.]*\s?(?:usd|eur|gbp|dollars?|euros?|pounds?)\b/i;
const GUARANTEE = /\bguarantee[sd]?\b|\b(?:will|shall)\s+(?:definitely\s+|certainly\s+|surely\s+)?(?:increase|boost|improve|raise|double|triple|grow|drive|generate|lift)\s+(?:your\s+|the\s+|site\s+)?(?:revenue|sales|profits?|conversions?|conversion\s+rates?|search\s+rankings?|rankings?|traffic|leads|roi)\b|\b(?:first|top)\s+(?:page|position|spot|result)s?\s+(?:of|on|in)\s+google\b|\brank(?:ing)?\s+#?1\b/gi;
const COMPLIANCE = /\b(?:wcag|ada|section\s+508|en\s+301\s+549)(?:\s+[\d.]+)?(?:\s+(?:level\s+)?a{1,3})?[\s-]+(?:compliant|conformant|certified)\b|\b(?:compliant|conformant|complies|conforms)\s+(?:with|to)\s+(?:the\s+)?(?:wcag|ada|section\s+508)\b|\bmeets?\s+(?:all\s+)?(?:of\s+)?(?:the\s+)?(?:wcag|ada)\b|\bfully\s+accessible\b/gi;
const NEGATION = /\b(?:not|no|never|cannot|can't|can\s+not|doesn't|does\s+not|don't|do\s+not|isn't|is\s+not|without|neither|nor|unable)\b/i;
const HEDGE = /\b(?:may|might|could|can|potentially|possibly|likely|if|where|when|depending)\b/i;

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.replace(/[.,;:!?]+$/, ""));
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

function parseNumber(token: string): number {
  return Number(token.replace(/,/g, ""));
}

function collect(value: unknown, numbers: number[], urls: Set<string>): void {
  if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
  else if (typeof value === "string") {
    for (const match of value.matchAll(NUMBER_IN_TEXT)) numbers.push(parseNumber(match[0]));
    for (const match of value.matchAll(URL_IN_TEXT)) {
      const url = normalizeUrl(match[0]);
      if (url) urls.add(url);
    }
  } else if (Array.isArray(value)) value.forEach((item) => collect(item, numbers, urls));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collect(item, numbers, urls));
}

export function buildCorpus(...values: unknown[]): EvidenceCorpus {
  const numbers: number[] = [];
  const urls = new Set<string>();
  values.forEach((value) => collect(value, numbers, urls));
  return { numbers: [...new Set(numbers)], urls };
}

export function mergeCorpora(corpora: EvidenceCorpus[]): EvidenceCorpus {
  return { numbers: [...new Set(corpora.flatMap((corpus) => corpus.numbers))], urls: new Set(corpora.flatMap((corpus) => [...corpus.urls])) };
}

/** Conversion factors from a stated unit to other units the evidence may use (s↔ms, KB↔bytes, %↔0–1 score). */
function conversions(unit: string): number[] {
  const u = unit.toLowerCase();
  if (u === "%" || u === "percent") return [1, 0.01];
  if (u === "ms" || u.startsWith("millisecond")) return [1, 0.001];
  if (u === "s" || u.startsWith("sec")) return [1, 1000];
  if (u === "kb" || u === "kib" || u.startsWith("kilobyte")) return [1, 1000, 1024];
  if (u === "mb" || u === "mib" || u.startsWith("megabyte")) return [1, 1000, 1024, 1_000_000, 1_048_576];
  if (u.startsWith("byte")) return [1, 0.001, 1 / 1024, 1e-6, 1 / 1_048_576];
  return [1];
}

function isSupported(token: string, unit: string, corpus: EvidenceCorpus): boolean {
  const value = parseNumber(token);
  const decimals = token.includes(".") ? token.split(".")[1]!.length : 0;
  const halfStep = 0.5 * 10 ** -decimals;
  return conversions(unit).some((factor) => {
    const candidate = value * factor;
    return corpus.numbers.some((known) => Math.abs(candidate - known) <= Math.max(0.05 * Math.abs(known), halfStep * factor, 1e-9));
  });
}

function unnegatedMatch(text: string, pattern: RegExp): string | null {
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (!NEGATION.test(before)) return match[0];
  }
  return null;
}

/** Returns a rejection reason when the text is not grounded in the corpus or makes a prohibited claim. */
export function checkText(text: string, corpus: EvidenceCorpus): string | null {
  if (CURRENCY.test(text)) return "Contains a monetary amount; ScopePilot has no revenue or pricing evidence.";
  const guarantee = unnegatedMatch(text, GUARANTEE);
  if (guarantee) return `Contains a guaranteed-outcome claim ("${guarantee}").`;
  const compliance = unnegatedMatch(text, COMPLIANCE);
  if (compliance) return `Contains a compliance claim ("${compliance}"); automated checks cannot establish compliance.`;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = normalizeUrl(match[0]);
    if (!url || !corpus.urls.has(url)) return `References a URL that is not part of the supplied evidence (${match[0]}).`;
  }
  for (const match of text.matchAll(MEASUREMENT_IN_TEXT)) {
    if (!isSupported(match[1]!, match[2]!, corpus)) return `States a measurement (${match[0]}) that does not match the supplied evidence.`;
  }
  return null;
}

export function checkHedged(text: string): string | null {
  return HEDGE.test(text) ? null : "Business relevance must be expressed conditionally (for example \"may\" or \"could\").";
}

const NO_GAPS = /\bno\s+(?:(?:major|significant|notable|material|obvious)\s+)?(?:evidence|data|coverage)\s+gaps?\b|\bno\s+(?:major|significant|notable|material|obvious)\s+(?:gaps|limitations|caveats)\b|\bwithout\s+any\s+(?:evidence\s+|data\s+)?gaps\b/i;
const FULL_COVERAGE = /\b(?:comprehensive|complete|full|exhaustive|thorough)\s+(?:audit|assessment|review|picture|coverage|analysis|evaluation)\b|\b(?:entire|whole)\s+(?:site|website)\b|\ball\s+(?:pages|of\s+the\s+(?:site|website))\b/gi;

/** Rejects reassuring scope claims that contradict known coverage limits. */
export function checkCoverageClaim(text: string, coverage: AuditCoverage | undefined): string | null {
  if (!coverage) return null;
  const hasGaps = coverage.notInspected.length + coverage.unavailable.length + coverage.limitations.length > 0;
  if (!hasGaps) return null;
  const noGaps = text.match(NO_GAPS);
  if (noGaps) return `Claims there were no evidence gaps ("${noGaps[0]}"), but the audit coverage lists uninspected areas, unavailable data or limitations.`;
  const full = [...text.matchAll(FULL_COVERAGE)].find((match) => !NEGATION.test(text.slice(0, match.index).split(/[.!?]\s/).pop() ?? ""));
  if (full) return `Claims full coverage ("${full[0]}"), but the audit coverage lists uninspected areas, unavailable data or limitations.`;
  return null;
}

export function groupCorpus(group: IssueGroup, rootUrl: string): EvidenceCorpus {
  return buildCorpus(group.evidence, group.affectedUrls, group.references, group.explanation, group.remediation, group.title, rootUrl);
}

export interface GroundingResult {
  content: InterpretationContent;
  rejected: InterpretationRejection[];
  uninterpretedRefs: string[];
}

export function groundInterpretation(output: AiInterpretationOutput, groups: IssueGroup[], corpora: Map<string, EvidenceCorpus>, globalCorpus: EvidenceCorpus, coverage?: AuditCoverage): GroundingResult {
  const rejected: InterpretationRejection[] = [];
  const byRef = new Map(groups.map((group) => [group.ref, group]));

  let overview: string | null = null;
  if (output.overview) {
    const reason = checkText(output.overview, globalCorpus) ?? checkCoverageClaim(output.overview, coverage);
    if (reason) rejected.push({ path: "overview", reason });
    else overview = output.overview;
  }

  const issues: InterpretedIssue[] = [];
  const seen = new Set<string>();
  output.issues.forEach((issue, index) => {
    const path = `issues[${index}]`;
    const group = byRef.get(issue.ref);
    if (!group) return rejected.push({ path, reason: `Refers to unknown issue "${issue.ref}"; it was not part of the supplied findings.` });
    if (seen.has(issue.ref)) return rejected.push({ path, reason: `Duplicate interpretation for ${issue.ref}.` });
    const corpus = corpora.get(group.ref)!;
    const reason = [issue.plainLanguage, issue.whyItMatters, issue.businessRelevance, ...issue.recommendedImprovements].map((text) => checkText(text, corpus)).find(Boolean) ?? checkHedged(issue.businessRelevance);
    if (reason) return rejected.push({ path, reason: `${issue.ref}: ${reason}` });
    seen.add(issue.ref);
    issues.push({ ...issue, category: group.category, ruleId: group.ruleId, title: group.title, severity: group.severity, findingIds: group.findingIds });
  });

  const opportunities: InterpretedOpportunity[] = [];
  output.opportunities.forEach((opportunity, index) => {
    const path = `opportunities[${index}]`;
    const refs = [...new Set(opportunity.refs.filter((ref) => byRef.has(ref)))];
    if (refs.length === 0) return rejected.push({ path, reason: "Opportunity does not reference any supplied issue." });
    const corpus = mergeCorpora(refs.map((ref) => corpora.get(ref)!));
    const reason = [opportunity.title, opportunity.summary, ...opportunity.deliverables].map((text) => checkText(text, corpus)).find(Boolean);
    if (reason) return rejected.push({ path, reason });
    if (refs.length !== opportunity.refs.length) rejected.push({ path: `${path}.refs`, reason: "Unknown or duplicate issue references were removed." });
    opportunities.push({ ...opportunity, refs, findingIds: [...new Set(refs.flatMap((ref) => byRef.get(ref)!.findingIds))] });
  });

  const evidenceGaps: string[] = [];
  output.evidenceGaps.forEach((gap, index) => {
    const reason = checkText(gap, globalCorpus) ?? checkCoverageClaim(gap, coverage);
    if (reason) rejected.push({ path: `evidenceGaps[${index}]`, reason });
    else evidenceGaps.push(gap);
  });

  return {
    content: { overview, issues, opportunities, evidenceGaps },
    rejected,
    uninterpretedRefs: groups.filter((group) => !seen.has(group.ref)).map((group) => group.ref),
  };
}
