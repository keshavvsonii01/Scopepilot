import type { PageInspection } from "@scopepilot/contracts/audit";
import { describe, expect, it } from "vitest";
import { analyzeSeo } from "../src/seo.js";

const ROOT = "https://example.com/";

function page(overrides: Partial<PageInspection> = {}): PageInspection {
  return {
    url: ROOT,
    title: "Example — Home",
    metaDescription: "A concise description of the example homepage.",
    headings: [{ level: 1, text: "Welcome" }, { level: 2, text: "Services" }],
    canonical: ROOT,
    robots: null,
    links: [],
    images: [{ src: "https://example.com/logo.png", alt: "Example logo" }],
    httpStatus: 200,
    finalUrl: ROOT,
    xRobotsTag: null,
    warnings: [],
    ...overrides,
  };
}

const ruleIds = (findings: { source: { ruleId: string } }[]) => findings.map((finding) => finding.source.ruleId).sort();

describe("analyzeSeo", () => {
  it("produces no findings for a well-formed page and records measurements", () => {
    const result = analyzeSeo({ rootUrl: ROOT, pages: [page()] });
    expect(result.run.status).toBe("completed");
    expect(result.findings).toEqual([]);
    expect(result.run.findingCount).toBe(0);
    expect(result.run.measurements?.pages[0]).toMatchObject({ url: ROOT, httpStatus: 200, titleLength: 14, h1Count: 1, imagesMissingAlt: 0 });
    expect(result.run.measurements?.coverage).toMatchObject({ pagesAnalyzed: 1, pagesNotLoaded: [] });
  });

  it("reports document-level issues with evidence, explanation and remediation", () => {
    const result = analyzeSeo({ rootUrl: ROOT, pages: [page({
      title: null,
      metaDescription: "x".repeat(200),
      headings: [{ level: 2, text: "Intro" }, { level: 4, text: "Deep" }],
      canonical: null,
      robots: "noindex, nofollow",
      images: [{ src: "https://example.com/a.png", alt: null }, { src: "https://example.com/b.png", alt: "" }],
      links: [{ href: "javascript:void(0)", text: "Menu" }],
    })] });

    expect(ruleIds(result.findings)).toEqual([
      "seo.image-missing-alt", "seo.meta-description-too-long", "seo.missing-canonical", "seo.missing-h1",
      "seo.missing-title", "seo.nofollow", "seo.noindex", "seo.non-crawlable-links", "seo.skipped-heading-level",
    ]);
    for (const finding of result.findings) {
      expect(finding).toMatchObject({ category: "seo", affectedUrl: ROOT, evidence: { kind: "page-signal" } });
      expect(finding.explanation.length).toBeGreaterThan(0);
      expect(finding.remediation.length).toBeGreaterThan(0);
    }
    const alt = result.findings.find((finding) => finding.source.ruleId === "seo.image-missing-alt")!;
    expect(alt.evidence).toMatchObject({ observed: 1, samples: ["https://example.com/a.png"] });
    expect(result.findings.find((finding) => finding.source.ruleId === "seo.missing-title")?.severity).toBe("high");
  });

  it("reads noindex from the X-Robots-Tag header and treats 'none' as noindex + nofollow", () => {
    const header = analyzeSeo({ rootUrl: ROOT, pages: [page({ xRobotsTag: "noindex" })] });
    expect(ruleIds(header.findings)).toEqual(["seo.noindex"]);
    const none = analyzeSeo({ rootUrl: ROOT, pages: [page({ robots: "none" })] });
    expect(ruleIds(none.findings)).toEqual(["seo.nofollow", "seo.noindex"]);
  });

  it("flags canonical problems", () => {
    expect(ruleIds(analyzeSeo({ rootUrl: ROOT, pages: [page({ canonical: "https://other.example/" })] }).findings)).toEqual(["seo.cross-origin-canonical"]);
    expect(ruleIds(analyzeSeo({ rootUrl: ROOT, pages: [page({ canonical: "ftp://example.com/" })] }).findings)).toEqual(["seo.invalid-canonical"]);
    expect(ruleIds(analyzeSeo({ rootUrl: ROOT, pages: [page({ canonical: "/pricing" })] }).findings)).toEqual(["seo.canonical-points-elsewhere"]);
  });

  it("reports internal pages returning HTTP errors as broken links with the linking pages", () => {
    const home = page({ links: [{ href: "/missing", text: "Missing" }, { href: "/about", text: "About" }] });
    const missing = page({ url: "https://example.com/missing", finalUrl: "https://example.com/missing", httpStatus: 404, title: null, canonical: null });
    const about = page({ url: "https://example.com/about", finalUrl: "https://example.com/about", title: "About", metaDescription: "About us.", canonical: "https://example.com/about" });
    const result = analyzeSeo({ rootUrl: ROOT, pages: [home, missing, about] });

    expect(ruleIds(result.findings)).toEqual(["seo.broken-internal-link"]);
    expect(result.findings[0]).toMatchObject({ severity: "high", basis: "measured", affectedUrl: "https://example.com/missing", evidence: { observed: 404, relatedUrls: [ROOT] } });
    expect(result.run.measurements?.coverage.internalLinksRequested).toBe(2);
  });

  it("reports duplicate titles and descriptions across healthy pages", () => {
    const about = page({ url: "https://example.com/about", finalUrl: "https://example.com/about", canonical: "https://example.com/about" });
    const result = analyzeSeo({ rootUrl: ROOT, pages: [page(), about] });
    expect(ruleIds(result.findings)).toEqual(["seo.duplicate-meta-description", "seo.duplicate-meta-description", "seo.duplicate-title", "seo.duplicate-title"]);
  });

  it("reports a redirect as informational", () => {
    const result = analyzeSeo({ rootUrl: "https://example.com/old", pages: [page({ url: "https://example.com/old", canonical: ROOT })] });
    expect(ruleIds(result.findings)).toEqual(["seo.redirect"]);
    expect(result.findings[0]?.severity).toBe("info");
  });

  it("does not evaluate pages the crawler failed to load and reports the module as partial", () => {
    const failed = page({ url: "https://example.com/slow", title: null, metaDescription: null, headings: [], httpStatus: null, finalUrl: null, warnings: [{ code: "PAGE_TIMEOUT", message: "timed out" }] });
    const result = analyzeSeo({ rootUrl: ROOT, pages: [page(), failed] });
    expect(result.run.status).toBe("partial");
    expect(result.findings).toEqual([]);
    expect(result.run.issues).toEqual([expect.objectContaining({ code: "PAGE_NOT_LOADED", url: "https://example.com/slow" })]);
    expect(result.run.measurements?.coverage.pagesNotLoaded).toEqual(["https://example.com/slow"]);
  });

  it("fails without fabricating findings when no page loaded", () => {
    const result = analyzeSeo({ rootUrl: ROOT, pages: [page({ title: null, warnings: [{ code: "PAGE_UNREACHABLE", message: "unreachable" }] })] });
    expect(result.run.status).toBe("failed");
    expect(result.run.measurements).toBeNull();
    expect(result.findings).toEqual([]);
    expect(result.run.issues[0]?.code).toBe("NO_PAGES_LOADED");
  });

  it("treats legacy inspections without navigation metadata as loaded", () => {
    const legacy = page();
    delete legacy.httpStatus; delete legacy.finalUrl; delete legacy.xRobotsTag;
    const result = analyzeSeo({ rootUrl: ROOT, pages: [legacy] });
    expect(result.run.status).toBe("completed");
    expect(result.run.measurements?.pages[0]).toMatchObject({ httpStatus: null, finalUrl: null });
  });

  describe("internal link counts", () => {
    const linksOf = (result: ReturnType<typeof analyzeSeo>) => {
      const measured = result.run.measurements!.pages[0]!;
      return [measured.internalLinkCount, measured.internalLinkTargetCount, result.run.measurements!.coverage.internalLinksDiscovered];
    };

    it("counts a self-link as an occurrence but not as a distinct target", () => {
      expect(linksOf(analyzeSeo({ rootUrl: ROOT, pages: [page({ links: [{ href: "/", text: "Home" }] })] }))).toEqual([1, 0, 0]);
    });

    it("counts repeated links once as a target and once per occurrence", () => {
      const links = [{ href: "/about", text: "About" }, { href: "/about", text: "About us" }, { href: "https://example.com/about#team", text: "Team" }, { href: "/", text: "Logo" }, { href: "https://other.test/", text: "Elsewhere" }];
      const result = analyzeSeo({ rootUrl: ROOT, pages: [page({ links })] });
      expect(linksOf(result)).toEqual([4, 1, 1]);
      expect(result.run.measurements!.pages[0]!.externalLinkCount).toBe(1);
      expect(result.run.notes.join(" ")).toContain("1 distinct internal link targets, excluding links from a page to itself");
    });

    it("reports zero for a page with no internal links", () => {
      expect(linksOf(analyzeSeo({ rootUrl: ROOT, pages: [page({ links: [{ href: "mailto:a@example.com", text: "Mail" }] })] }))).toEqual([0, 0, 0]);
    });
  });

  describe("image alt measurements", () => {
    const run = (images: PageInspection["images"]) => analyzeSeo({ rootUrl: ROOT, pages: [page({ images })] });

    it("counts <img> elements without src that have no alt", () => {
      const result = run([{ src: "", alt: null }, { src: "", alt: null }]);
      expect(result.run.measurements!.pages[0]).toMatchObject({ imageCount: 2, imagesMissingAlt: 2, imagesDecorative: 0 });
      const evidence = result.findings.find((item) => item.source.ruleId === "seo.image-missing-alt")!.evidence;
      expect(evidence).toMatchObject({ observed: 2, samples: ["<img> without a src attribute", "<img> without a src attribute"] });
    });

    it("treats empty alt and presentational roles as decorative, and whitespace alt as missing", () => {
      const result = run([
        { src: "/a.png", alt: "" },
        { src: "/b.png", alt: null, role: "presentation" },
        { src: "/c.png", alt: null, role: "none" },
        { src: "/d.png", alt: "  " },
        { src: "/e.png", alt: null },
        { src: "/f.png", alt: "Chart of sales" },
      ]);
      expect(result.run.measurements!.pages[0]).toMatchObject({ imageCount: 6, imagesMissingAlt: 2, imagesDecorative: 3 });
    });

    it("records zero images without producing an alt finding", () => {
      const result = run([]);
      expect(result.run.measurements!.pages[0]).toMatchObject({ imageCount: 0, imagesMissingAlt: 0 });
      expect(result.findings.some((item) => item.source.ruleId === "seo.image-missing-alt")).toBe(false);
    });
  });
});
