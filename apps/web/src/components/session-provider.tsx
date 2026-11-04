"use client";

import type { SessionResponse } from "@scopepilot/contracts/auth";
import { createContext, useContext, useState } from "react";
import { setSession } from "@/lib/api-client";

const SessionContext = createContext<SessionResponse | null>(null);

/** Makes the server-validated session available to client components and arms the in-memory CSRF token. */
export function SessionProvider({ session, children }: Readonly<{ session: SessionResponse; children: React.ReactNode }>) {
  // Set synchronously during the first render so child effects can already make authenticated writes.
  useState(() => { setSession(session); return null; });
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionResponse {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider.");
  return session;
}

export function useOptionalSession(): SessionResponse | null {
  return useContext(SessionContext);
}
