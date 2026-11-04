import { describe, expect, it } from "vitest";
import { withInspectionTimeout, InspectionTimeoutError } from "../src/execution.js";
import { deduplicateUrls, normalizeInspection, selectSameOriginLinks } from "../src/normalization.js";
import { type DnsResolver, UnsafeUrlError, validateCrawlTarget, validateRedirectTarget } from "../src/security.js";

const safeResolver: DnsResolver = { resolve: async () => ["93.184.216.34"] };
const blockedResolver: DnsResolver = { resolve: async () => ["169.254.169.254"] };

describe("crawl target security", () => {
  it.each(["http://localhost", "http://sub.localhost", "http://127.0.0.1", "http://10.0.0.8", "http://192.168.1.3", "http://[::1]"])('blocks localhost and private targets: %s', async (url) => {
    await expect(validateCrawlTarget(url, { resolver: safeResolver })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("blocks metadata and private DNS resolutions", async () => {
    await expect(validateCrawlTarget("https://target.example", { resolver: blockedResolver })).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });

  it("blocks unsupported protocols, credentials, and non-web ports", async () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com", "http://user:pass@example.com", "https://example.com:8443"]) {
      await expect(validateCrawlTarget(url, { resolver: safeResolver })).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it("revalidates every redirect destination against DNS and origin", async () => {
    await expect(validateRedirectTarget("/next", "https://safe.example/start", "https://safe.example", safeResolver)).resolves.toHaveProperty("pathname", "/next");
    await expect(validateRedirectTarget("https://attacker.example", "https://safe.example/start", "https://safe.example", safeResolver)).rejects.toMatchObject({ code: "CROSS_ORIGIN" });
    await expect(validateRedirectTarget("/metadata", "https://safe.example/start", "https://safe.example", blockedResolver)).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });
});

describe("crawl boundaries and normalized evidence", () => {
  it("deduplicates URLs and enforces the four-page maximum", () => {
    expect(deduplicateUrls(["https://example.com/", "https://example.com/#top", "https://example.com/work/", "https://example.com/work", "https://example.com/about", "https://example.com/contact"], 4)).toEqual(["https://example.com/", "https://example.com/work", "https://example.com/about", "https://example.com/contact"]);
  });

  it("keeps discovered pages on the submitted origin", () => {
    expect(selectSameOriginLinks("https://example.com/", [{ href: "/work" }, { href: "https://outside.example/path" }, { href: "/work#first" }, { href: "mailto:a@example.com" }])).toEqual(["https://example.com/work"]);
  });

  it("normalizes a successful inspection without inventing findings", () => {
    const inspection = normalizeInspection({ url: "https://example.com/", title: " Example ", metaDescription: null, canonical: null, robots: null, headings: [{ level: 1, text: " Example " }], links: [{ href: "/work", text: "Work" }, { href: "/work", text: "Work" }], images: [{ src: "", alt: null }, { src: "", alt: null }, { src: "/logo.png", alt: "Logo" }, { src: "/logo.png", alt: "Logo" }], warnings: [] });
    expect(inspection.images).toHaveLength(4);
    expect(inspection).toMatchObject({ title: "Example", headings: [{ level: 1, text: "Example" }], warnings: [] });
    expect(inspection.links).toHaveLength(1);
  });

  it("preserves an inaccessible-page warning as an explicit partial result", () => {
    const failedPage = normalizeInspection({ url: "https://example.com/unavailable", title: null, metaDescription: null, canonical: null, robots: null, headings: [], links: [], images: [], warnings: [{ code: "PAGE_UNREACHABLE", message: "The page could not be inspected." }] });
    expect(failedPage.warnings).toEqual([{ code: "PAGE_UNREACHABLE", message: "The page could not be inspected." }]);
    expect(failedPage.title).toBeNull();
  });

  it("fails a timed-out inspection rather than reporting completion", async () => {
    await expect(withInspectionTimeout(new Promise<void>(() => undefined), 5)).rejects.toBeInstanceOf(InspectionTimeoutError);
  });
});
