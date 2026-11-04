import type { SessionResponse } from "@scopepilot/contracts/auth";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthForm, describeAuthError } from "@/components/auth/auth-form";
import { SessionProvider } from "@/components/session-provider";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ApiError, auditApi, authApi, setSession } from "./api-client";

const session = (id: string, csrfToken: string): SessionResponse => ({
  user: { id, name: "Ada", email: "ada@example.com", createdAt: "2025-01-01T00:00:00.000Z" },
  workspace: { id: `w-${id}`, name: "Ada's workspace", kind: "personal", role: "owner" },
  csrfToken,
  expiresAt: "2025-01-08T00:00:00.000Z",
}) as SessionResponse;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const assign = vi.fn();
const replace = vi.fn();
const reload = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace" }));

function stubWindow(pathname = "/workspace/audits/abc") {
  vi.stubGlobal("window", { location: { pathname, search: "?tab=1", assign, replace, reload } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
  replace.mockReset();
  reload.mockReset();
  setSession(null);
});

describe("api client session handling", () => {
  it("sends the in-memory CSRF token on writes but not on reads", async () => {
    const fetchMock = vi.fn(async () => json(200, { audits: [] }));
    vi.stubGlobal("fetch", fetchMock);
    setSession(session("u1", "csrf-1"));
    await auditApi.list();
    await auditApi.create({ url: "https://example.com", mode: "quick", includeMobileChecks: true, includeAccessibilityChecks: true });
    const [readInit, writeInit] = fetchMock.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1]);
    expect((readInit!.headers as Record<string, string>)["x-csrf-token"]).toBeUndefined();
    expect((writeInit!.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-1");
    expect(writeInit!.credentials).toBe("same-origin");
  });

  it("refreshes the CSRF token once after a CSRF rejection and retries", async () => {
    const responses = [json(403, { error: "CSRF_INVALID", message: "x" }), json(200, session("u1", "csrf-2")), json(202, { id: "a" })];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);
    setSession(session("u1", "stale"));
    await expect(auditApi.create({ url: "https://example.com", mode: "quick", includeMobileChecks: true, includeAccessibilityChecks: true })).resolves.toEqual({ id: "a" });
    expect(((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-2");
  });

  it("reloads instead of retrying when another account signed in from a different tab", async () => {
    stubWindow();
    const responses = [json(403, { error: "CSRF_INVALID", message: "x" }), json(200, session("u2", "csrf-other"))];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    setSession(session("u1", "stale"));
    await expect(auditApi.create({ url: "https://example.com", mode: "quick", includeMobileChecks: true, includeAccessibilityChecks: true })).rejects.toMatchObject({ status: 403 });
    expect(reload).toHaveBeenCalled();
  });

  it("sends signed-out users to login, preserving where they were", async () => {
    stubWindow();
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { error: "UNAUTHENTICATED", message: "Sign in." })));
    await expect(auditApi.list()).rejects.toBeInstanceOf(ApiError);
    expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/workspace/audits/abc?tab=1")}`);
  });

  it("does not redirect on failed sign-in and clears the token on logout", async () => {
    stubWindow("/login");
    const responses = [json(401, { error: "INVALID_CREDENTIALS", message: "Email or password is incorrect." }), json(200, session("u1", "csrf-login")), new Response(null, { status: 204 })];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);
    await expect(authApi.login({ email: "a@example.com", password: "x" })).rejects.toMatchObject({ status: 401 });
    expect(replace).not.toHaveBeenCalled();
    await authApi.login({ email: "a@example.com", password: "right" });
    await authApi.logout();
    expect(((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-login");
  });
});

describe("auth UI", () => {
  it("renders the sign-in and registration forms with accessible fields", () => {
    const login = renderToStaticMarkup(<AuthForm mode="login" next="/workspace" />);
    expect(login).toContain('autoComplete="current-password"');
    expect(login).toContain("Password reset is not available yet");
    expect(login).not.toContain('id="name"');
    const register = renderToStaticMarkup(<AuthForm mode="register" next="/workspace/proposals" />);
    expect(register).toContain('id="name"');
    expect(register).toContain('autoComplete="new-password"');
    expect(register).toContain(`/login?next=${encodeURIComponent("/workspace/proposals")}`);
  });

  it("explains auth failures without leaking which part was wrong", () => {
    expect(describeAuthError(new ApiError(401, "INVALID_CREDENTIALS", "x"), "login")).toBe("Email or password is incorrect.");
    expect(describeAuthError(new ApiError(429, "RATE_LIMITED", "x", 600), "login")).toMatch(/10 minute/);
    expect(describeAuthError(new ApiError(401, "INVALID_CREDENTIALS", "x"), "register")).toMatch(/existing password/);
    expect(describeAuthError(new ApiError(0, "NETWORK_ERROR", "x"), "register")).toMatch(/could not be reached/);
  });

  it("registration never stores a session; the client signs in afterwards", async () => {
    const responses = [json(202, { status: "accepted", message: "m" }), json(200, session("u1", "csrf-after-login")), json(202, { id: "a" })];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);
    await expect(authApi.register({ name: "Ada", email: "ada@example.com", password: "long enough password" })).resolves.toEqual({ status: "accepted", message: "m" });
    await authApi.login({ email: "ada@example.com", password: "long enough password" });
    await auditApi.create({ url: "https://example.com", mode: "quick", includeMobileChecks: true, includeAccessibilityChecks: true });
    expect(((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-after-login");
  });

  it("shows the signed-in account and a logout control in the workspace shell", () => {
    const html = renderToStaticMarkup(<SessionProvider session={session("u1", "csrf")}><WorkspaceShell><p>content</p></WorkspaceShell></SessionProvider>);
    expect(html).toContain("Ada&#x27;s workspace");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("Log out");
    expect(html).not.toContain("Authentication pending");
    expect(html).not.toContain("csrf");
  });
});
