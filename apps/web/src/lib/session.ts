import type { SessionResponse } from "@scopepilot/contracts/auth";
import { headers } from "next/headers";
import { apiBaseUrl, sessionCookieHeader } from "./api-proxy";

export type SessionLookup = { kind: "signed-in"; session: SessionResponse } | { kind: "signed-out" } | { kind: "unavailable" };

/**
 * Validates the browser's session cookie with the API during server rendering. Only the session cookie
 * is forwarded. A cookie's presence is never trusted on its own.
 */
export async function lookupSession(): Promise<SessionLookup> {
  const cookie = sessionCookieHeader((await headers()).get("cookie"));
  if (!cookie) return { kind: "signed-out" };
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/auth/session`, { headers: { accept: "application/json", cookie }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (response.status === 401) return { kind: "signed-out" };
    if (!response.ok) return { kind: "unavailable" };
    return { kind: "signed-in", session: await response.json() as SessionResponse };
  } catch {
    return { kind: "unavailable" };
  }
}
