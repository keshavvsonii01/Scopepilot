import { describe, expect, it, vi } from "vitest";
import { allowedOrigins, apiBaseUrl, apiTimeoutMs, forwardToApi, sessionCookieHeader } from "./api-proxy";

const BASE = "http://api.test";
const ID = "65f0a1b2c3d4e5f6a7b8c9d0";

function fakeFetch(response: Response | Error) {
  return vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

describe("apiBaseUrl", () => {
  it("defaults to the local API and trims trailing slashes", () => {
    expect(apiBaseUrl({})).toBe("http://localhost:4000");
    expect(apiBaseUrl({ SCOPEPILOT_API_URL: "https://api.example.com/" })).toBe("https://api.example.com");
  });
});

describe("forwardToApi", () => {
  it("forwards allowed GET requests and passes status, body and retry-after through", async () => {
    const fetchImpl = fakeFetch(new Response(JSON.stringify({ error: "RATE_LIMITED" }), { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } }));
    const response = await forwardToApi(new Request("http://web.test/api/v1/audits"), ["audits", ID, "interpretation"], { baseUrl: BASE, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE}/v1/audits/${ID}/interpretation`, expect.objectContaining({ method: "GET" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "RATE_LIMITED" });
  });

  it("forwards POST bodies for audit creation", async () => {
    const fetchImpl = fakeFetch(Response.json({ id: ID }, { status: 202 }));
    const response = await forwardToApi(new Request("http://web.test/api/v1/audits", { method: "POST", body: "{\"url\":\"https://example.com\"}" }), ["audits"], { baseUrl: BASE, fetchImpl });
    expect(response.status).toBe(202);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "{\"url\":\"https://example.com\"}" });
  });

  it("rejects paths outside the allowlist without calling the API", async () => {
    const fetchImpl = fakeFetch(new Response("{}"));
    for (const segments of [["admin"], ["audits", "not-an-id"], ["audits", ID, "..", "secret"]]) {
      const response = await forwardToApi(new Request("http://web.test/x"), segments, { baseUrl: BASE, fetchImpl });
      expect(response.status).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects methods that are not allowed for a path", async () => {
    const fetchImpl = fakeFetch(new Response("{}"));
    const response = await forwardToApi(new Request("http://web.test/x", { method: "POST", body: "{}" }), ["audits", ID], { baseUrl: BASE, fetchImpl });
    expect(response.status).toBe(405);
    expect((await forwardToApi(new Request("http://web.test/x", { method: "DELETE" }), ["audits"], { baseUrl: BASE, fetchImpl })).status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    const fetchImpl = fakeFetch(new Response("{}"));
    const response = await forwardToApi(new Request("http://web.test/x", { method: "POST", body: "x".repeat(20_000) }), ["audits"], { baseUrl: BASE, fetchImpl });
    expect(response.status).toBe(413);
  });

  it("forwards proposal routes with their allowed methods, body sizes and query parameters", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ proposals: [] }));
    await forwardToApi(new Request(`http://web.test/api/v1/proposals?auditId=${ID}&secret=x`), ["proposals"], { baseUrl: BASE, fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${BASE}/v1/proposals?auditId=${ID}`);
    await forwardToApi(new Request("http://web.test/api/v1/proposals?auditId=../x"), ["proposals"], { baseUrl: BASE, fetchImpl });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(`${BASE}/v1/proposals`);

    const large = JSON.stringify({ text: "x".repeat(40_000) });
    const put = await forwardToApi(new Request("http://web.test/x", { method: "PUT", body: large }), ["proposals", ID], { baseUrl: BASE, fetchImpl });
    expect(put.status).toBe(200);
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({ method: "PUT", body: large });
    await forwardToApi(new Request("http://web.test/x", { method: "POST", body: "{}" }), ["proposals", ID, "draft"], { baseUrl: BASE, fetchImpl });
    expect(fetchImpl.mock.calls[3]?.[0]).toBe(`${BASE}/v1/proposals/${ID}/draft`);

    expect((await forwardToApi(new Request("http://web.test/x", { method: "PUT", body: "{}" }), ["audits", ID], { baseUrl: BASE, fetchImpl })).status).toBe(405);
    expect((await forwardToApi(new Request("http://web.test/x", { method: "DELETE" }), ["proposals", ID], { baseUrl: BASE, fetchImpl })).status).toBe(405);
    expect((await forwardToApi(new Request("http://web.test/x"), ["proposals", ID, "draft"], { baseUrl: BASE, fetchImpl })).status).toBe(405);
    expect((await forwardToApi(new Request("http://web.test/x", { method: "PUT", body: "x".repeat(300_000) }), ["proposals", ID], { baseUrl: BASE, fetchImpl })).status).toBe(413);
    expect((await forwardToApi(new Request("http://web.test/x"), ["proposals", "nope"], { baseUrl: BASE, fetchImpl })).status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("reports an unreachable API as 502 and a timeout as 504", async () => {
    const unreachable = await forwardToApi(new Request("http://web.test/x"), ["audits"], { baseUrl: BASE, fetchImpl: fakeFetch(new TypeError("fetch failed")) });
    expect(unreachable.status).toBe(502);
    expect(await unreachable.json()).toMatchObject({ error: "API_UNAVAILABLE" });
    const timedOut = await forwardToApi(new Request("http://web.test/x"), ["audits"], { baseUrl: BASE, fetchImpl: fakeFetch(new DOMException("timed out", "TimeoutError")) });
    expect(timedOut.status).toBe(504);
    expect(await timedOut.json()).toMatchObject({ error: "API_TIMEOUT" });
  });

  it("uses SCOPEPILOT_API_TIMEOUT_MS for reads, keeps the longer AI timeout, and ignores invalid values", () => {
    expect(apiTimeoutMs({})).toBe(15_000);
    expect(apiTimeoutMs({ SCOPEPILOT_API_TIMEOUT_MS: "75000" })).toBe(75_000);
    for (const bad of ["abc", "500", "999999", "1.5", ""]) expect(apiTimeoutMs({ SCOPEPILOT_API_TIMEOUT_MS: bad })).toBe(15_000);
  });

  it("applies the configured timeout to the upstream call", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const ok = () => fakeFetch(new Response("{}", { status: 200 }));
    await forwardToApi(new Request("http://web.test/x"), ["audits"], { baseUrl: BASE, fetchImpl: ok(), env: { SCOPEPILOT_API_TIMEOUT_MS: "75000" } });
    await forwardToApi(new Request("http://web.test/x", { method: "POST", body: "{}", headers: { origin: "http://web.test" } }), ["proposals", ID, "draft"], { baseUrl: BASE, fetchImpl: ok(), env: { SCOPEPILOT_API_TIMEOUT_MS: "75000" } });
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([75_000, 90_000]);
    timeout.mockRestore();
  });
});

describe("authentication forwarding", () => {
  const TOKEN = "s".repeat(43);
  const CSRF = "c".repeat(43);

  it("forwards only the session cookie, the CSRF header and the client address", async () => {
    const fetchImpl = fakeFetch(new Response(JSON.stringify({ audits: [] }), { status: 200 }));
    const request = new Request("http://web.test/api/v1/audits", { method: "POST", body: "{}", headers: { cookie: `theme=dark; scopepilot_session=${TOKEN}; _ga=1`, "x-csrf-token": CSRF, "x-forwarded-for": "198.51.100.1, 203.0.113.9", origin: "http://web.test", authorization: "Bearer leaked" } });
    await forwardToApi(request, ["audits"], { baseUrl: BASE, fetchImpl });
    const headers = new Headers(fetchImpl.mock.calls[0]![1]!.headers);
    expect(headers.get("cookie")).toBe(`scopepilot_session=${TOKEN}`);
    expect(headers.get("x-csrf-token")).toBe(CSRF);
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(headers.get("authorization")).toBeNull();
  });

  it("sends the proxy secret and client address only when SCOPEPILOT_PROXY_SECRET is set", async () => {
    const SECRET = "p".repeat(64);
    const send = async (env: Record<string, string>) => {
      const fetchImpl = fakeFetch(new Response("{}", { status: 200 }));
      await forwardToApi(new Request("http://web.test/api/v1/audits", { headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9", "x-scopepilot-proxy-secret": "forged" } }), ["audits"], { baseUrl: BASE, fetchImpl, env });
      return new Headers(fetchImpl.mock.calls[0]![1]!.headers);
    };
    const withSecret = await send({ SCOPEPILOT_PROXY_SECRET: SECRET });
    expect(withSecret.get("x-scopepilot-proxy-secret")).toBe(SECRET);
    expect(withSecret.get("x-scopepilot-client-ip")).toBe("203.0.113.9");
    const without = await send({});
    expect(without.get("x-scopepilot-proxy-secret")).toBeNull();
    expect(without.get("x-scopepilot-client-ip")).toBeNull();
  });

  it("drops malformed CSRF headers and requests without a session cookie", async () => {
    const fetchImpl = fakeFetch(new Response("{}", { status: 401 }));
    await forwardToApi(new Request("http://web.test/api/v1/audits", { headers: { cookie: "other=1", "x-csrf-token": "bad token\n" } }), ["audits"], { baseUrl: BASE, fetchImpl });
    const headers = new Headers(fetchImpl.mock.calls[0]![1]!.headers);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-csrf-token")).toBeNull();
  });

  it("passes the API's session Set-Cookie back but no other cookies", async () => {
    const upstream = new Response(JSON.stringify({ user: {} }), { status: 201 });
    upstream.headers.append("set-cookie", `scopepilot_session=${TOKEN}; Path=/; HttpOnly; SameSite=Lax`);
    upstream.headers.append("set-cookie", "tracker=1; Path=/");
    const response = await forwardToApi(new Request("http://web.test/api/v1/auth/register", { method: "POST", body: "{}", headers: { origin: "http://web.test" } }), ["auth", "register"], { baseUrl: BASE, fetchImpl: fakeFetch(upstream) });
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual([`scopepilot_session=${TOKEN}; Path=/; HttpOnly; SameSite=Lax`]);
  });

  it("forwards a 204 logout with the clearing cookie", async () => {
    const upstream = new Response(null, { status: 204, headers: { "set-cookie": "scopepilot_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT" } });
    const response = await forwardToApi(new Request("http://web.test/api/v1/auth/logout", { method: "POST", body: "{}", headers: { origin: "http://web.test" } }), ["auth", "logout"], { baseUrl: BASE, fetchImpl: fakeFetch(upstream) });
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()[0]).toMatch(/^scopepilot_session=;/);
  });

  it("refuses cross-origin writes before they reach the API", async () => {
    const fetchImpl = fakeFetch(new Response("{}"));
    for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
      const response = await forwardToApi(new Request("http://web.test/api/v1/auth/login", { method: "POST", body: "{}", headers }), ["auth", "login"], { baseUrl: BASE, fetchImpl });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "ORIGIN_REJECTED" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    const allowed = await forwardToApi(new Request("http://internal:3000/api/v1/auth/login", { method: "POST", body: "{}", headers: { origin: "https://app.example.com" } }), ["auth", "login"], { baseUrl: BASE, fetchImpl, env: { SCOPEPILOT_ALLOWED_ORIGINS: "https://app.example.com/" } });
    expect(allowed.status).toBe(200);
  });

  it("exposes only the documented auth routes and methods", async () => {
    const fetchImpl = fakeFetch(new Response("{}"));
    expect((await forwardToApi(new Request("http://web.test/api/v1/auth/session", { method: "POST", body: "{}" }), ["auth", "session"], { baseUrl: BASE, fetchImpl })).status).toBe(405);
    expect((await forwardToApi(new Request("http://web.test/api/v1/auth/login"), ["auth", "login"], { baseUrl: BASE, fetchImpl })).status).toBe(405);
    expect((await forwardToApi(new Request("http://web.test/api/v1/auth/users"), ["auth", "users"], { baseUrl: BASE, fetchImpl })).status).toBe(404);
    expect((await forwardToApi(new Request("http://web.test/api/v1/account"), ["account"], { baseUrl: BASE, fetchImpl })).status).toBe(200);
  });

  it("parses cookie headers and allowed origins defensively", () => {
    expect(sessionCookieHeader(`__Host-scopepilot_session=${TOKEN}; scopepilot_session_x=1`)).toBe(`__Host-scopepilot_session=${TOKEN}`);
    expect(sessionCookieHeader(null)).toBeNull();
    expect([...allowedOrigins("http://web.test/x", { SCOPEPILOT_ALLOWED_ORIGINS: "not a url, https://a.example" })]).toEqual(["http://web.test", "https://a.example"]);
  });
});