import type { PageInspection } from "@scopepilot/contracts/audit";
import { normalizeCrawlUrl } from "./security.js";

export function deduplicateUrls(urls: Iterable<string>, limit = 4): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of urls) {
    let normalized: string;
    try { normalized = normalizeCrawlUrl(value).toString(); } catch { continue; }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length === limit) break;
  }
  return result;
}

export function selectSameOriginLinks(pageUrl: string, links: Array<{ href: string }>, limit = 3): string[] {
  const page = new URL(pageUrl);
  const candidates = links.flatMap(({ href }) => {
    try { const url = normalizeCrawlUrl(new URL(href, page)); return url.origin === page.origin && /^https?:$/.test(url.protocol) ? [url.toString()] : []; } catch { return []; }
  });
  return deduplicateUrls(candidates.filter((url) => url !== normalizeCrawlUrl(page).toString()), limit);
}

export function normalizeInspection(page: PageInspection): PageInspection {
  return {
    ...page,
    url: normalizeCrawlUrl(page.url).toString(),
    title: page.title?.trim() || null,
    metaDescription: page.metaDescription?.trim() || null,
    canonical: page.canonical?.trim() || null,
    robots: page.robots?.trim() || null,
    headings: page.headings.map((heading) => ({ ...heading, text: heading.text.trim() })).filter((heading) => Boolean(heading.text)),
    links: Array.from(new Map(page.links.map((link) => [`${link.href}\u0000${link.text}`, link])).values()),
    // Kept per element (not deduplicated) so counts match per-node accessibility checks.
    images: page.images,
  };
}
