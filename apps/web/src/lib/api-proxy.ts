/**
 * Server-side forwarding from the web app to the ScopePilot API. The browser only ever calls
 * same-origin `/api/v1/...`; the API location stays server-side and no provider keys pass through here.
 *
 * Authentication: only the ScopePilot session cookie and CSRF header are forwarded upstream, and only the
 * API's session Set-Cookie headers come back. Writes from another origin are refused before reaching the API.
 */

interface Route {
  pattern: RegExp;
  methods: readonly string[];
  /** Maximum forwarded body size in characters. */
  maxBody: number;
  /** Timeout for non-GET requests. */
  writeTimeoutMs?: number;
}

/** Generation waits on the AI provider (60 s timeout) plus persistence. */
const AI_TIMEOUT_MS = 90_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const SMALL_BODY = 16_384;
/** Proposal documents are larger than audit submissions; the API enforces its own 256 KB limit. */
const PROPOSAL_BODY = 262_144;
const OBJECT_ID = "[a-f0-9]{24}";

const ROUTES: readonly Route[] = [
  { pattern: /^auth\/(register|login|logout)$/i, methods: ["POST"], maxBody: SMALL_BODY },
  { pattern: /^auth\/session$/i, methods: ["GET"], maxBody: 0 },
  { pattern: /^account$/i, methods: ["GET"], maxBody: 0 },
  { pattern: /^audits$/i, methods: ["GET", "POST"], maxBody: SMALL_BODY },
  { pattern: new RegExp(`^audits/${OBJECT_ID}$`, "i"), methods: ["GET"], maxBody: 0 },
  { pattern: new RegExp(`^audits/${OBJECT_ID}/interpretation$`, "i"), methods: ["GET", "POST"], maxBody: SMALL_BODY, writeTimeoutMs: AI_TIMEOUT_MS },
  { pattern: /^proposals$/i, methods: ["GET", "POST"], maxBody: PROPOSAL_BODY },
  { pattern: new RegExp(`^proposals/${OBJECT_ID}$`, "i"), methods: ["GET", "PUT"], maxBody: PROPOSAL_BODY },
  { pattern: new RegExp(`^proposals/${OBJECT_ID}/draft$`, "i"), methods: ["POST"], maxBody: SMALL_BODY, writeTimeoutMs: AI_TIMEOUT_MS },
  { pattern: new RegExp(`^proposals/${OBJECT_ID}/pdf$`, "i"), methods: ["GET"], maxBody: 0 },
];

/** Query parameters forwarded per path. Anything else is dropped. */
const ALLOWED_QUERY: Record<string, { name: string; pattern: RegExp }[]> = {
  proposals: [{ name: "auditId", pattern: new RegExp(`^${OBJECT_ID}$`, "i") }],
};

export function apiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.SCOPEPILOT_API_URL?.trim() || "http://localhost:4000").replace(/\/+$/, "");
}

/**
 * Read timeout for API calls (SCOPEPILOT_API_TIMEOUT_MS, 1 000–300 000). Raise it when the API host
 * sleeps when idle and needs time to wake. AI routes always get at least their own longer timeout.
 */
export function apiTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.SCOPEPILOT_API_TIMEOUT_MS?.trim());
  return Number.isInteger(value) && value >= 1_000 && value <= 300_000 ? value : DEFAULT_TIMEOUT_MS;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function forwardedQuery(path: string, requestUrl: string): string {
  const allowed = ALLOWED_QUERY[path.toLowerCase()];
  if (!allowed) return "";
  let source: URLSearchParams;
  try { source = new URL(requestUrl).searchParams; } catch { return ""; }
  const query = new URLSearchParams();
  for (const { name, pattern } of allowed) {
    const value = source.get(name);
    if (value && pattern.test(value)) query.set(name, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

const SESSION_COOKIE = /^(__Host-)?scopepilot_session$/;
const CSRF_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** Returns only the ScopePilot session cookie(s) from a Cookie header; other site cookies never leave the web server. */
export function sessionCookieHeader(header: string | null): string | null {
  if (!header) return null;
  const kept = header.split(";").map((part) => part.trim()).filter((part) => SESSION_COOKIE.test(part.slice(0, part.indexOf("="))));
  return kept.length ? kept.join("; ") : null;
}

/**
 * Origins allowed to make state-changing requests: the request's own origin plus SCOPEPILOT_ALLOWED_ORIGINS
 * (comma-separated, for deployments where the public origin differs from the server's view of the URL).
 */
export function allowedOrigins(requestUrl: string, env: Record<string, string | undefined> = process.env): Set<string> {
  const origins = new Set<string>();
  try { origins.add(new URL(requestUrl).origin); } catch { /* ignore */ }
  for (const value of (env.SCOPEPILOT_ALLOWED_ORIGINS ?? "").split(",")) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    try { origins.add(new URL(trimmed).origin); } catch { /* ignore malformed entries */ }
  }
  return origins;
}

/** Browsers send Origin (and Sec-Fetch-Site) on fetch writes; anything cross-site is refused. */
function crossSiteWrite(request: Request, env?: Record<string, string | undefined>): boolean {
  const origin = request.headers.get("origin");
  if (origin) return !allowedOrigins(request.url, env).has(origin);
  return request.headers.get("sec-fetch-site") === "cross-site";
}

/** The address Next.js (or the reverse proxy in front of it) recorded for the client: the right-most hop. */
function clientAddress(request: Request): string | null {
  const hops = request.headers.get("x-forwarded-for")?.split(",").map((hop) => hop.trim()).filter(Boolean);
  const last = hops?.at(-1);
  return last && /^[0-9a-fA-F:.]{2,45}$/.test(last) ? last : null;
}

function upstreamHeaders(request: Request, hasBody: boolean, env: Record<string, string | undefined>): Headers {
  const headers = new Headers({ accept: "application/json" });
  if (hasBody) headers.set("content-type", "application/json");
  const cookie = sessionCookieHeader(request.headers.get("cookie"));
  if (cookie) headers.set("cookie", cookie);
  const csrf = request.headers.get("x-csrf-token");
  if (csrf && CSRF_TOKEN.test(csrf)) headers.set("x-csrf-token", csrf);
  const client = clientAddress(request);
  if (client) headers.set("x-forwarded-for", client);
  // Proves to a publicly reachable API that this request came through the web proxy (apps/api/src/app.ts, proxySecret).
  const secret = env.SCOPEPILOT_PROXY_SECRET?.trim();
  if (secret) {
    headers.set("x-scopepilot-proxy-secret", secret);
    if (client) headers.set("x-scopepilot-client-ip", client);
  }
  return headers;
}

export interface ForwardOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

export async function forwardToApi(request: Request, segments: string[], options: ForwardOptions = {}): Promise<Response> {
  const path = segments.join("/");
  const method = request.method.toUpperCase();
  const route = ROUTES.find((candidate) => candidate.pattern.test(path));
  if (!route) return json(404, { error: "NOT_FOUND", message: "Unknown API route." });
  if (!route.methods.includes(method)) return json(405, { error: "METHOD_NOT_ALLOWED", message: "Method not allowed." });

  const env = options.env ?? process.env;
  if (method !== "GET" && crossSiteWrite(request, env)) return json(403, { error: "ORIGIN_REJECTED", message: "Cross-origin requests are not allowed." });

  const body = method === "GET" ? undefined : await request.text();
  if (body !== undefined && body.length > route.maxBody) return json(413, { error: "PAYLOAD_TOO_LARGE", message: "Request body is too large." });
  const readTimeoutMs = apiTimeoutMs(env);
  const timeoutMs = method !== "GET" && route.writeTimeoutMs ? Math.max(route.writeTimeoutMs, readTimeoutMs) : readTimeoutMs;

  let upstream: Response;
  try {
    upstream = await (options.fetchImpl ?? fetch)(`${options.baseUrl ?? apiBaseUrl(env)}/v1/${path}${forwardedQuery(path, request.url)}`, {
      method,
      headers: upstreamHeaders(request, body !== undefined, env),
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") return json(504, { error: "API_TIMEOUT", message: "The ScopePilot API did not respond in time." });
    return json(502, { error: "API_UNAVAILABLE", message: "The ScopePilot API could not be reached." });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const pdf = upstream.ok && contentType.startsWith("application/pdf");
  const payload = pdf ? await upstream.arrayBuffer() : await upstream.text();
  const headers = new Headers({ "content-type": contentType, "cache-control": "no-store" });
  const disposition = upstream.headers.get("content-disposition");
  if (pdf && disposition) headers.set("content-disposition", disposition);
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  for (const cookie of upstream.headers.getSetCookie()) {
    if (SESSION_COOKIE.test(cookie.slice(0, cookie.indexOf("=")))) headers.append("set-cookie", cookie);
  }
  return new Response(upstream.status === 204 ? null : payload, { status: upstream.status, headers });
}
