import type { AuditFinding, FindingSeverity, ModuleIssue, PageSignalEvidence, SeoMeasurements, SeoPageMeasurement } from "@scopepilot/contracts/analysis";
import type { PageInspection } from "@scopepilot/contracts/audit";
import { selectSameOriginLinks } from "@scopepilot/crawl-core/normalization";
import { normalizeCrawlUrl } from "@scopepilot/crawl-core/security";
import { findingId, moduleResult, type ModuleResult, truncate } from "./findings.js";

export const TITLE_MAX_LENGTH = 60;
export const META_DESCRIPTION_MAX_LENGTH = 160;
const SAMPLE_LIMIT = 5;
const LOAD_FAILURE_CODES = new Set(["PAGE_TIMEOUT", "PAGE_UNREACHABLE"]);
const SOURCE = "scopepilot-seo-rules" as const;

export interface SeoInput {
  rootUrl: string;
  pages: PageInspection[];
}

interface SeoRule {
  ruleId: string;
  severity: FindingSeverity;
  basis: AuditFinding["basis"];
  title: string;
  explanation: string;
  remediation: string;
  references?: string[];
}

const RULES = {
  errorStatus: { ruleId: "seo.error-status", severity: "high", basis: "measured", title: "Page returned an HTTP error status", explanation: "The server responded to the submitted URL with an HTTP error status. Search engines generally do not index error responses, and visitors see an error instead of content.", remediation: "Confirm the URL is correct and fix the server or routing configuration so the page returns HTTP 200." },
  brokenInternalLink: { ruleId: "seo.broken-internal-link", severity: "high", basis: "measured", title: "Internal link leads to an HTTP error", explanation: "An internal link discovered on the site was requested and the server responded with an HTTP error status. Broken internal links waste crawl budget and interrupt visitors.", remediation: "Update or remove links pointing to this URL, or restore the page / add a redirect to the correct destination." },
  redirect: { ruleId: "seo.redirect", severity: "info", basis: "measured", title: "Requested URL redirects", explanation: "The requested URL redirected to a different final URL. Redirects are often intentional, but internal links that point at redirecting URLs add an extra request.", remediation: "If the redirect is intentional, update internal links to point directly at the final URL." },
  missingTitle: { ruleId: "seo.missing-title", severity: "high", basis: "rule-based", title: "Missing page title", explanation: "No <title> text was found in the captured document. Search engines use the title as the primary headline in results.", remediation: "Add a unique, descriptive <title> that summarizes the page content.", references: ["https://developers.google.com/search/docs/appearance/title-link"] },
  longTitle: { ruleId: "seo.title-too-long", severity: "low", basis: "rule-based", title: "Page title may be truncated in search results", explanation: `The title is longer than ${TITLE_MAX_LENGTH} characters. Search results truncate titles by pixel width, so long titles commonly lose their ending; ${TITLE_MAX_LENGTH} characters is an approximate guideline, not a hard limit.`, remediation: "Place the most important words first and consider shortening the title.", references: ["https://developers.google.com/search/docs/appearance/title-link"] },
  duplicateTitle: { ruleId: "seo.duplicate-title", severity: "medium", basis: "rule-based", title: "Title duplicated across inspected pages", explanation: "Multiple inspected pages share the same title, which makes them harder for search engines and users to distinguish.", remediation: "Give each page a unique title that reflects its specific content." },
  missingMetaDescription: { ruleId: "seo.missing-meta-description", severity: "medium", basis: "rule-based", title: "Missing meta description", explanation: "No <meta name=\"description\"> content was found. Search engines may use it as the result snippet; without it they generate one from page text.", remediation: "Add a concise meta description that accurately summarizes the page.", references: ["https://developers.google.com/search/docs/appearance/snippet"] },
  longMetaDescription: { ruleId: "seo.meta-description-too-long", severity: "low", basis: "rule-based", title: "Meta description may be truncated", explanation: `The meta description is longer than ${META_DESCRIPTION_MAX_LENGTH} characters. Snippets are truncated by width, so ${META_DESCRIPTION_MAX_LENGTH} characters is an approximate guideline.`, remediation: "Keep the key message in the first sentence of the description." },
  duplicateMetaDescription: { ruleId: "seo.duplicate-meta-description", severity: "low", basis: "rule-based", title: "Meta description duplicated across inspected pages", explanation: "Multiple inspected pages share the same meta description.", remediation: "Write a description specific to each page." },
  missingH1: { ruleId: "seo.missing-h1", severity: "medium", basis: "rule-based", title: "No H1 heading with text", explanation: "No <h1> element containing text was found in the captured document. A clear H1 helps users and search engines understand the page's main topic. (An H1 containing only an image or rendered client-side would not be detected.)", remediation: "Add one visible <h1> that describes the page's primary topic." },
  multipleH1: { ruleId: "seo.multiple-h1", severity: "low", basis: "rule-based", title: "Multiple H1 headings", explanation: "More than one <h1> with text was found. This is valid HTML, but a single primary heading usually gives a clearer document outline.", remediation: "Consider keeping one H1 for the main topic and using H2–H6 for sections." },
  skippedHeading: { ruleId: "seo.skipped-heading-level", severity: "low", basis: "rule-based", title: "Heading levels are skipped", explanation: "The heading outline jumps more than one level (for example H2 to H4), which weakens the document structure for assistive technology and search engines.", remediation: "Use heading levels sequentially to reflect the content hierarchy; style headings with CSS rather than choosing levels by size." },
  missingCanonical: { ruleId: "seo.missing-canonical", severity: "low", basis: "rule-based", title: "No canonical URL declared", explanation: "No <link rel=\"canonical\"> was found. Without it, search engines choose a canonical URL themselves when duplicates exist (for example with tracking parameters).", remediation: "Add a self-referencing canonical link with the preferred absolute URL.", references: ["https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"] },
  invalidCanonical: { ruleId: "seo.invalid-canonical", severity: "medium", basis: "rule-based", title: "Canonical URL is not a valid HTTP(S) URL", explanation: "The canonical link value could not be resolved to an HTTP(S) URL, so search engines are likely to ignore it.", remediation: "Set the canonical href to a valid absolute HTTP(S) URL." },
  crossOriginCanonical: { ruleId: "seo.cross-origin-canonical", severity: "medium", basis: "rule-based", title: "Canonical URL points to a different origin", explanation: "The canonical link points to another scheme, host or port. If unintentional, search engines may consolidate this page into the other origin.", remediation: "Confirm the cross-origin canonical is intentional; otherwise point it to this page's own URL." },
  canonicalElsewhere: { ruleId: "seo.canonical-points-elsewhere", severity: "info", basis: "rule-based", title: "Canonical URL points to a different page", explanation: "The canonical link points to another URL on the same origin. This is correct for duplicate pages but removes this page from search results if unintentional.", remediation: "Confirm this page is meant to be consolidated into the canonical URL." },
  noindex: { ruleId: "seo.noindex", severity: "high", basis: "rule-based", title: "Page asks search engines not to index it", explanation: "A robots meta tag or X-Robots-Tag header contains noindex (or none). Search engines will drop this page from results.", remediation: "Remove the noindex directive if the page should appear in search results.", references: ["https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag"] },
  nofollow: { ruleId: "seo.nofollow", severity: "medium", basis: "rule-based", title: "Page asks search engines not to follow its links", explanation: "A robots meta tag or X-Robots-Tag header contains nofollow (or none), so search engines will not follow links on this page.", remediation: "Remove the nofollow directive unless it is intentional.", references: ["https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag"] },
  missingAlt: { ruleId: "seo.image-missing-alt", severity: "medium", basis: "rule-based", title: "Images missing alt attributes", explanation: "Some <img> elements have no alt attribute, or only whitespace. Alt text describes images to search engines and screen-reader users. (Images with an empty alt=\"\" or role=\"presentation\"/\"none\" are treated as intentionally decorative and are not counted.)", remediation: "Add descriptive alt text to informative images and alt=\"\" to purely decorative ones." },
  javascriptLinks: { ruleId: "seo.non-crawlable-links", severity: "low", basis: "rule-based", title: "Links that search engines cannot follow", explanation: "Some links use javascript: URLs instead of a real href, so crawlers cannot discover their destination.", remediation: "Use <a href> with a real URL for navigation and attach behavior with event handlers instead.", references: ["https://developers.google.com/search/docs/crawling-indexing/links-crawlable"] },
} satisfies Record<string, SeoRule>;

function finding(rule: SeoRule, affectedUrl: string, evidence: Omit<PageSignalEvidence, "kind">, discriminator?: string): AuditFinding {
  return {
    id: findingId(rule.ruleId, affectedUrl, discriminator),
    category: "seo",
    severity: rule.severity,
    basis: rule.basis,
    title: rule.title,
    source: { tool: SOURCE, ruleId: rule.ruleId },
    affectedUrl,
    evidence: { kind: "page-signal", ...evidence },
    explanation: rule.explanation,
    remediation: rule.remediation,
    references: rule.references ?? [],
  };
}

function sameUrl(a: string, b: string): boolean {
  try { return normalizeCrawlUrl(a).toString() === normalizeCrawlUrl(b).toString(); } catch { return a === b; }
}

function isLoaded(page: PageInspection): boolean {
  return !page.warnings.some((warning) => LOAD_FAILURE_CODES.has(warning.code));
}

function robotsDirectives(page: PageInspection): Set<string> {
  return new Set([page.robots, page.xRobotsTag].filter((value): value is string => Boolean(value)).flatMap((value) => value.toLowerCase().split(/[\s,]+/)));
}

function internalLinkTargets(page: PageInspection): string[] {
  return selectSameOriginLinks(page.url, page.links, Number.MAX_SAFE_INTEGER);
}

const DECORATIVE_ROLES = new Set(["presentation", "none"]);

/** Decorative per the existing rule semantics: empty alt, or an explicit presentational role. */
function isDecorative(image: PageInspection["images"][number]): boolean {
  return image.alt === "" || (image.alt === null && DECORATIVE_ROLES.has((image.role ?? "").trim().toLowerCase()));
}

/** No alt attribute, or one containing only whitespace (which axe-core also rejects). */
function lacksAlt(image: PageInspection["images"][number]): boolean {
  return !isDecorative(image) && (image.alt === null || image.alt.trim() === "");
}

function measure(page: PageInspection): SeoPageMeasurement {
  const origin = new URL(page.url).origin;
  let internal = 0;
  let external = 0;
  for (const link of page.links) {
    try { const url = new URL(link.href, page.url); if (!/^https?:$/.test(url.protocol)) continue; if (url.origin === origin) internal += 1; else external += 1; } catch { /* unparseable hrefs are not counted */ }
  }
  return {
    url: page.url,
    httpStatus: page.httpStatus ?? null,
    finalUrl: page.finalUrl ?? null,
    titleLength: page.title ? page.title.length : null,
    metaDescriptionLength: page.metaDescription ? page.metaDescription.length : null,
    h1Count: page.headings.filter((heading) => heading.level === 1).length,
    headingCount: page.headings.length,
    canonical: page.canonical,
    robots: page.robots,
    xRobotsTag: page.xRobotsTag ?? null,
    imageCount: page.images.length,
    imagesMissingAlt: page.images.filter(lacksAlt).length,
    imagesDecorative: page.images.filter(isDecorative).length,
    internalLinkCount: internal,
    internalLinkTargetCount: internalLinkTargets(page).length,
    externalLinkCount: external,
  };
}

function documentFindings(page: PageInspection): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const url = page.url;

  if (!page.title) findings.push(finding(RULES.missingTitle, url, { signal: "title", observed: null, expected: "A non-empty <title>" }));
  else if (page.title.length > TITLE_MAX_LENGTH) findings.push(finding(RULES.longTitle, url, { signal: "title-length", observed: page.title.length, expected: `≤ ${TITLE_MAX_LENGTH} characters (approximate)`, samples: [page.title] }));

  if (!page.metaDescription) findings.push(finding(RULES.missingMetaDescription, url, { signal: "meta-description", observed: null, expected: "A non-empty meta description" }));
  else if (page.metaDescription.length > META_DESCRIPTION_MAX_LENGTH) findings.push(finding(RULES.longMetaDescription, url, { signal: "meta-description-length", observed: page.metaDescription.length, expected: `≤ ${META_DESCRIPTION_MAX_LENGTH} characters (approximate)`, samples: [page.metaDescription] }));

  const h1s = page.headings.filter((heading) => heading.level === 1);
  if (h1s.length === 0) findings.push(finding(RULES.missingH1, url, { signal: "h1-count", observed: 0, expected: "Exactly one H1 with text" }));
  else if (h1s.length > 1) findings.push(finding(RULES.multipleH1, url, { signal: "h1-count", observed: h1s.length, expected: "One H1", samples: h1s.slice(0, SAMPLE_LIMIT).map((heading) => truncate(heading.text, 160)), sampleTotal: h1s.length }));

  const skips: string[] = [];
  for (let index = 1; index < page.headings.length; index += 1) {
    const previous = page.headings[index - 1]!;
    const current = page.headings[index]!;
    if (current.level > previous.level + 1) skips.push(`H${previous.level} "${truncate(previous.text, 60)}" → H${current.level} "${truncate(current.text, 60)}"`);
  }
  if (skips.length) findings.push(finding(RULES.skippedHeading, url, { signal: "heading-sequence", observed: skips.length, expected: "Heading levels increase by at most one", samples: skips.slice(0, SAMPLE_LIMIT), sampleTotal: skips.length }));

  if (!page.canonical) findings.push(finding(RULES.missingCanonical, url, { signal: "canonical", observed: null, expected: "<link rel=\"canonical\" href=\"…\">" }));
  else {
    let canonical: URL | null = null;
    try { canonical = new URL(page.canonical, page.finalUrl ?? url); } catch { canonical = null; }
    if (!canonical || !/^https?:$/.test(canonical.protocol)) findings.push(finding(RULES.invalidCanonical, url, { signal: "canonical", observed: page.canonical, expected: "An absolute HTTP(S) URL" }));
    else if (canonical.origin !== new URL(page.finalUrl ?? url).origin) findings.push(finding(RULES.crossOriginCanonical, url, { signal: "canonical", observed: canonical.toString(), expected: `A URL on ${new URL(page.finalUrl ?? url).origin}` }));
    else if (!sameUrl(canonical.toString(), page.finalUrl ?? url)) findings.push(finding(RULES.canonicalElsewhere, url, { signal: "canonical", observed: canonical.toString(), expected: "The page's own URL (if it is not a duplicate)" }));
  }

  const directives = robotsDirectives(page);
  const robotsObserved = [page.robots && `meta robots: ${page.robots}`, page.xRobotsTag && `X-Robots-Tag: ${page.xRobotsTag}`].filter(Boolean).join("; ");
  if (directives.has("noindex") || directives.has("none")) findings.push(finding(RULES.noindex, url, { signal: "robots", observed: robotsObserved, expected: "No noindex directive for pages meant to be searchable" }));
  if (directives.has("nofollow") || directives.has("none")) findings.push(finding(RULES.nofollow, url, { signal: "robots", observed: robotsObserved, expected: "No nofollow directive unless intentional" }));

  const missingAlt = page.images.filter(lacksAlt);
  if (missingAlt.length) findings.push(finding(RULES.missingAlt, url, { signal: "img-alt", observed: missingAlt.length, expected: "Every <img> has an alt attribute", samples: missingAlt.slice(0, SAMPLE_LIMIT).map((image) => image.src ? truncate(image.src, 200) : "<img> without a src attribute"), sampleTotal: missingAlt.length }));

  const scriptLinks = page.links.filter((link) => link.href.trim().toLowerCase().startsWith("javascript:"));
  if (scriptLinks.length) findings.push(finding(RULES.javascriptLinks, url, { signal: "link-href", observed: scriptLinks.length, expected: "Links use crawlable href URLs", samples: scriptLinks.slice(0, SAMPLE_LIMIT).map((link) => truncate(`${link.text || "(no text)"} → ${link.href}`, 200)), sampleTotal: scriptLinks.length }));

  return findings;
}

function duplicateFindings(pages: PageInspection[], field: "title" | "metaDescription", rule: SeoRule): AuditFinding[] {
  const groups = new Map<string, PageInspection[]>();
  for (const page of pages) {
    const value = page[field];
    if (value) groups.set(value, [...(groups.get(value) ?? []), page]);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 1).flatMap(([value, group]) => group.map((page) => finding(rule, page.url, {
    signal: field === "title" ? "title" : "meta-description",
    observed: value,
    expected: "Unique per page",
    relatedUrls: group.filter((other) => other !== page).map((other) => other.url),
  })));
}

/** Evaluates SEO rules over documents already captured by the crawler; it performs no network requests. */
export function analyzeSeo(input: SeoInput): ModuleResult<SeoMeasurements> {
  const root = normalizeCrawlUrl(input.rootUrl).toString();
  const loaded = input.pages.filter(isLoaded);
  const notLoaded = input.pages.filter((page) => !isLoaded(page)).map((page) => page.url);
  const issues: ModuleIssue[] = notLoaded.map((url) => ({ code: "PAGE_NOT_LOADED", message: "The page could not be loaded by the crawler, so SEO rules were not evaluated for it.", url }));

  const discovered = new Set(loaded.flatMap(internalLinkTargets));
  const requested = input.pages.filter((page) => !sameUrl(page.url, root));
  const notes = [
    "SEO rules evaluate the HTML captured with JavaScript disabled; content rendered client-side is not evaluated.",
    `Only internal pages the crawler requested were checked for HTTP errors (${requested.length} requested; ${discovered.size} distinct internal link targets, excluding links from a page to itself, discovered on loaded pages). Unrequested links were not checked.`,
    "robots.txt and XML sitemaps are not checked in this phase.",
  ];

  if (!loaded.length) return moduleResult<SeoMeasurements>({ status: "failed", measurements: null, issues: [{ code: "NO_PAGES_LOADED", message: "No inspected page loaded successfully; SEO rules could not be evaluated." }, ...issues], notes });

  const findings: AuditFinding[] = [];
  const healthy: PageInspection[] = [];
  for (const page of loaded) {
    const isRoot = sameUrl(page.url, root);
    if (page.finalUrl && !sameUrl(page.finalUrl, page.url)) findings.push(finding(RULES.redirect, page.url, { signal: "redirect", observed: page.finalUrl, expected: "The requested URL serves content directly" }));
    if (typeof page.httpStatus === "number" && page.httpStatus >= 400) {
      const linkedFrom = loaded.filter((other) => other !== page && internalLinkTargets(other).some((target) => sameUrl(target, page.url))).map((other) => other.url);
      findings.push(finding(isRoot ? RULES.errorStatus : RULES.brokenInternalLink, page.url, { signal: "http-status", observed: page.httpStatus, expected: "HTTP 2xx", relatedUrls: linkedFrom.length ? linkedFrom : undefined }));
      continue;
    }
    healthy.push(page);
    findings.push(...documentFindings(page));
  }
  findings.push(...duplicateFindings(healthy, "title", RULES.duplicateTitle), ...duplicateFindings(healthy, "metaDescription", RULES.duplicateMetaDescription));

  return moduleResult({
    status: notLoaded.length ? "partial" : "completed",
    measurements: {
      pages: loaded.map(measure),
      coverage: { pagesAnalyzed: loaded.length, pagesNotLoaded: notLoaded, internalLinksDiscovered: discovered.size, internalLinksRequested: requested.length },
    },
    issues,
    notes,
  }, findings);
}
