import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["__Host-scopepilot_session", "scopepilot_session"];

/**
 * Optimistic redirect only: a request without any session cookie cannot be signed in, so it goes straight
 * to /login. Requests with a cookie are validated against the API by the workspace layout.
 */
export function proxy(request: NextRequest) {
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/workspace", "/workspace/:path*"] };
