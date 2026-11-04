/** Authentication and workspace contracts shared by the API and the web app. */

export const AUTH_LIMITS = {
  nameMax: 80,
  emailMax: 254,
  passwordMin: 12,
  passwordMax: 128,
} as const;

export type WorkspaceRole = "owner";
export type WorkspaceKind = "personal";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  role: WorkspaceRole;
}

/**
 * Registration answers identically whether or not the email is already registered, and never
 * signs the caller in, so the response cannot be used to discover accounts. Sign in afterwards.
 */
export interface RegisterResponse {
  status: "accepted";
  message: string;
}

export const REGISTER_ACCEPTED_MESSAGE = "If this email can be used for a new account, the account is ready. Sign in with the email and password you chose.";

/** Returned by login and the session endpoint. Never contains the session token. */
export interface SessionResponse {
  user: AuthUser;
  workspace: AuthWorkspace;
  /** Per-session anti-CSRF token. Send it as `x-csrf-token` on state-changing requests. Keep it in memory only. */
  csrfToken: string;
  expiresAt: string;
}

export interface AccountResponse {
  user: AuthUser;
  workspace: AuthWorkspace;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export type AuthParse<T> = { ok: true; value: T } | { ok: false; field: "name" | "email" | "password" | "body"; error: string };

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Canonical form used for uniqueness and lookups. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateName(value: unknown): string | null {
  if (typeof value !== "string") return "Enter your name.";
  const name = value.trim();
  if (!name) return "Enter your name.";
  if (name.length > AUTH_LIMITS.nameMax) return `Name must be at most ${AUTH_LIMITS.nameMax} characters.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return "Name contains invalid characters.";
  return null;
}

export function validateEmail(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "Enter your email address.";
  const email = normalizeEmail(value);
  if (email.length > AUTH_LIMITS.emailMax || !EMAIL.test(email)) return "Enter a valid email address.";
  return null;
}

/** Length-based policy (NIST SP 800-63B style): no composition rules, but a sensible minimum. */
export function validatePassword(value: unknown, context: { email?: string } = {}): string | null {
  if (typeof value !== "string" || value.length === 0) return "Enter a password.";
  if (value.length < AUTH_LIMITS.passwordMin) return `Password must be at least ${AUTH_LIMITS.passwordMin} characters.`;
  if (value.length > AUTH_LIMITS.passwordMax) return `Password must be at most ${AUTH_LIMITS.passwordMax} characters.`;
  if (!value.trim()) return "Password cannot be only spaces.";
  if (context.email && normalizeEmail(value) === normalizeEmail(context.email)) return "Password must not be your email address.";
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseRegisterInput(value: unknown): AuthParse<RegisterInput> {
  const body = record(value);
  if (!body) return { ok: false, field: "body", error: "A JSON object is required." };
  const nameError = validateName(body.name);
  if (nameError) return { ok: false, field: "name", error: nameError };
  const emailError = validateEmail(body.email);
  if (emailError) return { ok: false, field: "email", error: emailError };
  const passwordError = validatePassword(body.password, { email: body.email as string });
  if (passwordError) return { ok: false, field: "password", error: passwordError };
  return { ok: true, value: { name: (body.name as string).trim(), email: normalizeEmail(body.email as string), password: body.password as string } };
}

/** Login only checks shape; policy is not re-validated so older passwords still work. */
export function parseLoginInput(value: unknown): AuthParse<LoginInput> {
  const body = record(value);
  if (!body) return { ok: false, field: "body", error: "A JSON object is required." };
  if (typeof body.email !== "string" || !body.email.trim() || body.email.length > AUTH_LIMITS.emailMax) return { ok: false, field: "email", error: "Enter your email address." };
  if (typeof body.password !== "string" || !body.password || body.password.length > AUTH_LIMITS.passwordMax) return { ok: false, field: "password", error: "Enter your password." };
  return { ok: true, value: { email: normalizeEmail(body.email), password: body.password } };
}

/** Only same-site relative paths are accepted as post-login destinations (prevents open redirects). */
export function safeNextPath(value: unknown, fallback = "/workspace"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value.startsWith("/workspace") ? value : fallback;
}
