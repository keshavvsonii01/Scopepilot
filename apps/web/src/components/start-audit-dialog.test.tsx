import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { ApiError } from "@/lib/api-client";
import { gateForSessionError, NEW_AUDIT_PATH, StartAuditBody, StartAuditDialog } from "./start-audit-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const noop = () => undefined;

describe("landing page audit entry points", () => {
  const html = renderToStaticMarkup(<HomePage />);

  it("keeps the hero Prospect Website form inline and submitting directly", () => {
    const hero = /<form id="start"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
    expect(hero).toContain('for="site-url"');
    expect(hero).toContain("Prospect website");
    expect(hero).toContain('type="submit"');
    expect(hero).not.toContain("aria-haspopup");
  });

  it("opens the shared dialog from every secondary audit CTA, keeping #start as the no-JS fallback", () => {
    const triggers = [...html.matchAll(/<a class="button button-primary" href="#start" aria-haspopup="dialog">([^<]+)/g)].map((match) => match[1].trim());
    expect(triggers).toEqual(["Start an audit", "Start with a website", "Start an audit"]);
    const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? "";
    expect(footer).toContain('href="#start" aria-haspopup="dialog"');
    expect(html.match(/<dialog/g)).toHaveLength(1);
  });

  it("renders the dialog closed and labelled until a CTA opens it", () => {
    expect(html).toMatch(/<dialog(?![^>]*\sopen)[^>]*aria-labelledby="start-audit-title"[^>]*aria-describedby="start-audit-lede"/);
    expect(html).not.toContain('id="audit-url"');
  });
});

describe("start audit dialog", () => {
  it("reuses the workspace audit form with options, autofocus on the URL field, when signed in", () => {
    const html = renderToStaticMarkup(<StartAuditBody initialGate={{ kind: "signed-in" }} onCreated={noop} onRetry={noop} />);
    expect(html).toContain('id="audit-url"');
    expect(html).toContain('name="mode"');
    expect(html).toContain("Mobile performance run");
    expect(html).toContain("Submit audit");
  });

  it("offers sign-in and registration that return to the audit form when signed out", () => {
    const html = renderToStaticMarkup(<StartAuditBody initialGate={{ kind: "signed-out" }} onCreated={noop} onRetry={noop} />);
    const next = encodeURIComponent(NEW_AUDIT_PATH);
    expect(html).toContain(`href="/login?next=${next}"`);
    expect(html).toContain(`href="/register?next=${next}"`);
    expect(html).not.toContain('id="audit-url"');
  });

  it("shows loading and retryable error states", () => {
    expect(renderToStaticMarkup(<StartAuditBody onCreated={noop} onRetry={noop} />)).toContain('role="status"');
    expect(renderToStaticMarkup(<StartAuditBody initialGate={{ kind: "error" }} onCreated={noop} onRetry={noop} />)).toContain("Try again");
  });

  it("treats only a 401 session response as signed out", () => {
    expect(gateForSessionError(new ApiError(401, "UNAUTHENTICATED", "x"))).toEqual({ kind: "signed-out" });
    expect(gateForSessionError(new ApiError(503, "UNAVAILABLE", "x"))).toEqual({ kind: "error" });
    expect(gateForSessionError(new ApiError(0, "NETWORK_ERROR", "x"))).toEqual({ kind: "error" });
  });

  it("has an accessible close control and does not render form content while closed", () => {
    const html = renderToStaticMarkup(<StartAuditDialog open={false} onClose={noop} />);
    expect(html).toContain('aria-label="Close audit dialog"');
    expect(html).not.toContain("<form");
  });
});
//h
