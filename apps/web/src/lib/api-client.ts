import type { AuditStatusResponse, CreateAuditInput } from "@scopepilot/contracts/audit";
import type { LoginInput, RegisterInput, RegisterResponse, SessionResponse } from "@scopepilot/contracts/auth";
import type { AuditListResponse, InterpretationResponse } from "@scopepilot/contracts/interpretation";
import type { CreateProposalInput, ProposalDraftResponse, ProposalListResponse, ProposalResponse, UpdateProposalInput } from "@scopepilot/contracts/proposal";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSeconds?: number, readonly body?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

/** CSRF token for the current session. Kept in memory only, never in localStorage or sessionStorage. */
let csrfToken: string | null = null;
let currentUserId: string | null = null;

export function setSession(session: Pick<SessionResponse, "csrfToken" | "user"> | null): void {
  csrfToken = session?.csrfToken ?? null;
  currentUserId = session?.user.id ?? null;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function redirectToLogin(): void {
  if (typeof window === "undefined" || window.location.pathname.startsWith("/login")) return;
  window.location.replace(`/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) };
  if (UNSAFE.has(method) && csrfToken) headers["x-csrf-token"] = csrfToken;
  try {
    return await fetch(`/api/v1/${path}`, { cache: "no-store", credentials: "same-origin", ...init, headers });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "The ScopePilot web server could not be reached.");
  }
}

/** Re-reads the session after a CSRF rejection. Reloads if a different account signed in from another tab. */
async function refreshCsrf(): Promise<boolean> {
  const response = await send("auth/session");
  if (!response.ok) return false;
  const session = await response.json().catch(() => null) as SessionResponse | null;
  if (!session) return false;
  if (currentUserId && session.user.id !== currentUserId && typeof window !== "undefined") {
    window.location.reload();
    return false;
  }
  setSession(session);
  return true;
}

interface RequestOptions { auth?: boolean }

async function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, init);
  if (response.status === 403 && !options.auth) {
    const code = await response.clone().json().then((body: { error?: string }) => body.error, () => undefined);
    if (code === "CSRF_INVALID" && await refreshCsrf()) response = await send(path, init);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as (T & { error?: string; message?: string }) | null;
  if (!response.ok || body === null) {
    if (response.status === 401 && !options.auth) redirectToLogin();
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ApiError(response.status, body?.error ?? "UNEXPECTED_RESPONSE", body?.message ?? `Request failed with HTTP ${response.status}.`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined, body ?? undefined);
  }
  return body;
}

export const authApi = {
  /** Never signs in: the API answers identically for new and taken emails. Call `login` next. */
  register: (input: RegisterInput) => request<RegisterResponse>("auth/register", { method: "POST", body: JSON.stringify(input) }, { auth: true }),
  login: async (input: LoginInput) => { const session = await request<SessionResponse>("auth/login", { method: "POST", body: JSON.stringify(input) }, { auth: true }); setSession(session); return session; },
  logout: async () => { try { await request<void>("auth/logout", { method: "POST", body: "{}" }, { auth: true }); } finally { setSession(null); } },
  session: () => request<SessionResponse>("auth/session", undefined, { auth: true }),
};
export const auditApi = {
  list: () => request<AuditListResponse>("audits"),
  get: (auditId: string) => request<AuditStatusResponse>(`audits/${encodeURIComponent(auditId)}`),
  create: (input: CreateAuditInput) => request<AuditStatusResponse>("audits", { method: "POST", body: JSON.stringify(input) }),
  interpretation: (auditId: string) => request<InterpretationResponse>(`audits/${encodeURIComponent(auditId)}/interpretation`),
  generateInterpretation: (auditId: string) => request<InterpretationResponse>(`audits/${encodeURIComponent(auditId)}/interpretation`, { method: "POST", body: "{}" }),
};

export const proposalApi = {
  list: (auditId?: string) => request<ProposalListResponse>(auditId ? `proposals?auditId=${encodeURIComponent(auditId)}` : "proposals"),
  get: (proposalId: string) => request<ProposalResponse>(`proposals/${encodeURIComponent(proposalId)}`),
  create: (input: CreateProposalInput) => request<ProposalResponse>("proposals", { method: "POST", body: JSON.stringify(input) }),
  update: (proposalId: string, input: UpdateProposalInput) => request<ProposalResponse>(`proposals/${encodeURIComponent(proposalId)}`, { method: "PUT", body: JSON.stringify(input) }),
  draft: (proposalId: string) => request<ProposalDraftResponse>(`proposals/${encodeURIComponent(proposalId)}/draft`, { method: "POST", body: "{}" }),
  /** Downloads the PDF rendered server-side from the saved proposal. */
  pdf: async (proposalId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await send(`proposals/${encodeURIComponent(proposalId)}/pdf`);
    if (response.ok && (response.headers.get("content-type") ?? "").startsWith("application/pdf")) {
      const filename = /filename="([a-z0-9.-]+\.pdf)"/i.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "scopepilot-proposal.pdf";
      return { blob: await response.blob(), filename };
    }
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    if (response.status === 401) redirectToLogin();
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ApiError(response.status, body?.error ?? "UNEXPECTED_RESPONSE", body?.message ?? `PDF export failed with HTTP ${response.status}.`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined, body ?? undefined);
  },
};
