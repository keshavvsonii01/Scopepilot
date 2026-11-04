import type { AuditResult, AuditSubmission, InspectionWarning, PageInspection } from "@scopepilot/contracts/audit";
import { InspectionTimeoutError, withInspectionTimeout } from "@scopepilot/crawl-core/execution";
import { normalizeInspection, selectSameOriginLinks } from "@scopepilot/crawl-core/normalization";
import { type DnsResolver, normalizeCrawlUrl, UnsafeUrlError, validateCrawlTarget } from "@scopepilot/crawl-core/security";
import { chromium, type Browser, type Page } from "playwright";

const PAGE_TIMEOUT_MS = 15_000;
export const CRAWL_JOB_TIMEOUT_MS = 90_000;
const MAX_SCREENSHOT_BYTES = 1_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;

/** Runs against a loaded page after document extraction (same page, same security boundary); must not navigate. */
export type PageAnalysisHook = (page: Page, url: string) => Promise<void>;
export interface CrawlHooks { afterExtract?: PageAnalysisHook; }

type ExtractedDocument = Omit<PageInspection, "url" | "screenshot" | "warnings" | "httpStatus" | "finalUrl" | "xRobotsTag">;
interface RequestBoundaryState { blockedNavigationCode?: string; }
const EXTRACTION_SCRIPT = `(() => {
  const text = (element) => element && element.textContent ? element.textContent.replace(/\\s+/g, " ").trim() || null : null;
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((element) => ({ level: Number(element.tagName.slice(1)), text: text(element) || "" }));
  const links = Array.from(document.querySelectorAll("a[href]")).map((element) => ({ href: element.getAttribute("href") || "", text: text(element) || "" })).filter((link) => Boolean(link.href));
  const images = Array.from(document.querySelectorAll("img")).map((element) => ({ src: element.getAttribute("src") || "", alt: element.getAttribute("alt"), role: element.getAttribute("role") }));
  return { title: document.title || null, metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content") || null, canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") || null, robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") || null, headings, links, images };
})()`;

async function screenshot(page: Page, warnings: InspectionWarning[]): Promise<{ desktop?: string; mobile?: string }> {
  const result: { desktop?: string; mobile?: string } = {};
  for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
    try {
      await page.setViewportSize(viewport);
      const image = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false, timeout: 8_000 });
      if (image.byteLength > MAX_SCREENSHOT_BYTES) warnings.push({ code: "SCREENSHOT_TOO_LARGE", message: `${name} screenshot was not persisted because it exceeded the storage limit.` });
      else result[name] = image.toString("base64");
    } catch { warnings.push({ code: "SCREENSHOT_FAILED", message: `${name} screenshot could not be captured.` }); }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  return result;
}

export async function extractDocument(page: Page): Promise<ExtractedDocument> {
  return page.evaluate(EXTRACTION_SCRIPT) as Promise<ExtractedDocument>;
}

async function inspectPage(page: Page, url: string, boundary: RequestBoundaryState, hooks: CrawlHooks): Promise<PageInspection> {
  const warnings: InspectionWarning[] = [];
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    const navigation = { httpStatus: response?.status() ?? null, finalUrl: page.url() || null, xRobotsTag: response?.headers()["x-robots-tag"] ?? null };
    const extracted = await extractDocument(page);
    if (hooks.afterExtract) { try { await hooks.afterExtract(page, normalizeCrawlUrl(url).toString()); } catch { /* analysis hooks record their own failures */ } }
    const captured = await screenshot(page, warnings);
    return normalizeInspection({ ...extracted, ...navigation, url, screenshot: captured, warnings });
  } catch (error) {
    const timeout = error instanceof Error && /timeout/i.test(error.message);
    const navigationError = error instanceof Error ? error.message.match(/net::[A-Z_]+/)?.[0] : undefined;
    warnings.push({ code: timeout ? "PAGE_TIMEOUT" : "PAGE_UNREACHABLE", message: timeout ? "The page exceeded the per-page timeout." : `The page could not be inspected${boundary.blockedNavigationCode ? `: blocked by ${boundary.blockedNavigationCode}.` : navigationError ? `: ${navigationError}.` : "."}` });
    return { url, title: null, metaDescription: null, headings: [], canonical: null, robots: null, links: [], images: [], warnings };
  }
}

async function configureRequestBoundary(page: Page, rootOrigin: string, resolver?: DnsResolver): Promise<RequestBoundaryState> {
  const state: RequestBoundaryState = {};
  page.on("response", (response) => {
    const size = Number(response.headers()["content-length"] ?? 0);
    if (response.request().isNavigationRequest() && Number.isFinite(size) && size > MAX_RESPONSE_BYTES) void page.close();
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (["script", "media", "websocket", "manifest"].includes(request.resourceType())) return route.abort();
    try { await validateCrawlTarget(request.url(), { rootOrigin, resolver }); await route.continue(); }
    catch (error) { if (request.isNavigationRequest() && error instanceof UnsafeUrlError) state.blockedNavigationCode = error.code; await route.abort(); }
  });
  return state;
}

export async function inspectWebsite(submission: AuditSubmission, resolver?: DnsResolver, hooks: CrawlHooks = {}): Promise<AuditResult> {
  const root = await validateCrawlTarget(submission.url, { resolver });
  const browser: Browser = await chromium.launch({ headless: true, args: ["--disable-background-networking", "--disable-default-apps", "--disable-extensions", "--disable-sync", "--no-first-run"] });
  try {
    return await withInspectionTimeout((async () => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false, acceptDownloads: false, serviceWorkers: "block" });
      try {
        const page = await context.newPage();
        const boundary = await configureRequestBoundary(page, root.origin, resolver);
        const home = await inspectPage(page, root.toString(), boundary, hooks);
        const result: AuditResult = { pages: [home], warnings: [] };
        if (submission.mode === "standard") {
          const candidates = selectSameOriginLinks(home.url, home.links, 3);
          for (const candidate of candidates) {
            try { await validateCrawlTarget(candidate, { rootOrigin: root.origin, resolver }); result.pages.push(await inspectPage(page, candidate, boundary, hooks)); }
            catch (error) { if (error instanceof UnsafeUrlError) result.warnings.push({ code: "PAGE_UNREACHABLE", message: "A discovered page was excluded by the crawl security boundary." }); }
          }
        }
        if (result.pages.length >= 4 && selectSameOriginLinks(home.url, home.links, 4).length > 3) result.warnings.push({ code: "PAGE_LIMIT_REACHED", message: "Only the homepage and three internal pages can be inspected in one audit." });
        return result;
      } finally { await context.close(); }
    })(), CRAWL_JOB_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof InspectionTimeoutError) throw error;
    throw error;
  } finally { await browser.close(); }
}
