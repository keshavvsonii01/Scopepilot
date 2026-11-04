import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { authApi } from "@/lib/api-client";
import { DASHBOARD_PATH, NavAuthLinkView, resolveNavAuth } from "./nav-auth-link";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const session = {
  user: { id: "u1", name: "Ada", email: "ada@example.com", createdAt: "2025-01-01T00:00:00.000Z" },
  workspace: { id: "w1", name: "Ada's workspace", kind: "personal", role: "owner" },
  csrfToken: "csrf",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("landing navbar auth link", () => {
  it("shows Dashboard for a valid session, checked via the same-origin proxy with the cookie", async () => {
    const fetchMock = vi.fn(async () => json(200, session));
    vi.stubGlobal("fetch", fetchMock);
    const state = await resolveNavAuth();
    expect(state).toBe("signed-in");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/session", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    expect(renderToStaticMarkup(<NavAuthLinkView state={state} />)).toBe(`<a href="${DASHBOARD_PATH}">Dashboard</a>`);
  });

  it("shows Sign in without redirecting when there is no session", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/", search: "", replace } });
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { error: "UNAUTHENTICATED" })));
    const state = await resolveNavAuth();
    expect(state).toBe("signed-out");
    expect(replace).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(<NavAuthLinkView state={state} />)).toBe('<a href="/login">Sign in</a>');
  });

  it("falls back to Sign in when the session check cannot reach the server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await expect(resolveNavAuth()).resolves.toBe("signed-out");
  });

  it("returns to Sign in after logout invalidates the session", async () => {
    let signedIn = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("auth/logout")) { signedIn = false; return new Response(null, { status: 204 }); }
      return signedIn ? json(200, session) : json(401, { error: "UNAUTHENTICATED" });
    }));
    await expect(resolveNavAuth()).resolves.toBe("signed-in");
    await authApi.logout();
    await expect(resolveNavAuth()).resolves.toBe("signed-out");
  });

  it("keeps the static homepage navbar on Sign in until the client confirms a session", () => {
    const nav = /<nav[^>]*aria-label="Primary navigation"[\s\S]*?<\/nav>/.exec(renderToStaticMarkup(<HomePage />))?.[0] ?? "";
    expect(nav).toContain('<a href="/login">Sign in</a>');
    expect(nav).not.toContain("Dashboard");
  });
});
