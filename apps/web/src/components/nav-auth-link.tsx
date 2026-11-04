"use client";

import { useEffect, useState } from "react";
import { authApi } from "@/lib/api-client";

export const DASHBOARD_PATH = "/workspace";

export type NavAuthState = "signed-in" | "signed-out";

/** Reads the HttpOnly session through the same-origin proxy. Any failure is treated as signed out. */
export function resolveNavAuth(): Promise<NavAuthState> {
  return authApi.session().then(() => "signed-in" as const, () => "signed-out" as const);
}

export function NavAuthLinkView({ state }: Readonly<{ state: NavAuthState }>) {
  return state === "signed-in" ? <a href={DASHBOARD_PATH}>Dashboard</a> : <a href="/login">Sign in</a>;
}

/** Public-page navbar link. Renders "Sign in" statically, then swaps to "Dashboard" once a session is confirmed. */
export function NavAuthLink() {
  const [state, setState] = useState<NavAuthState>("signed-out");

  useEffect(() => {
    let active = true;
    const check = () => { void resolveNavAuth().then((next) => { if (active) setState(next); }); };
    // Pages restored from the back/forward cache skip mount effects, so recheck after logout + Back.
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    check();
    window.addEventListener("pageshow", onPageShow);
    return () => { active = false; window.removeEventListener("pageshow", onPageShow); };
  }, []);

  return <NavAuthLinkView state={state} />;
}
