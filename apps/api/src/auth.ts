import type { AuthUser, AuthWorkspace, LoginInput, RegisterInput, SessionResponse } from "@scopepilot/contracts/auth";
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CreateAccountResult, NewSession, SessionRecord } from "@scopepilot/persistence/auth";

/** Persistence used by authentication. Implemented by @scopepilot/persistence/auth. */
export interface AuthStore {
  createAccount(input: { name: string; email: string; passwordHash: string }): Promise<CreateAccountResult>;
  findCredentials(email: string): Promise<{ user: AuthUser; passwordHash: string } | null>;
  findUser(userId: string): Promise<AuthUser | null>;
  findMembership(userId: string, workspaceId: string): Promise<AuthWorkspace | null>;
  findPersonalWorkspace(userId: string): Promise<AuthWorkspace | null>;
  createSession(session: NewSession): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(tokenHash: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/** Argon2id with the library defaults (m=19 MiB, t=2, p=1), which meet the OWASP minimum. */
export const argon2idHasher: PasswordHasher = {
  hash: (password) => argon2Hash(password, { algorithm: Algorithm.Argon2id }),
  verify: async (passwordHash, password) => {
    try { return await argon2Verify(passwordHash, password); }
    catch { return false; }
  },
};

export interface SessionPolicy {
  /** Absolute session lifetime. */
  ttlMs: number;
  /** Sessions unused for this long expire even before the absolute lifetime. */
  idleMs: number;
  /** Minimum interval between idle-expiry refreshes, to avoid a write on every request. */
  touchIntervalMs: number;
  /** Secure cookies are required in production; local HTTP development uses non-secure cookies. */
  secureCookie: boolean;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = { ttlMs: 7 * 24 * 3_600_000, idleMs: 24 * 3_600_000, touchIntervalMs: 5 * 60_000, secureCookie: false };

/** `__Host-` cookies must be Secure, Path=/ and host-only, which pins them to the exact origin. */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-scopepilot_session" : "scopepilot_session";
}

export interface AuthContext {
  user: AuthUser;
  workspace: AuthWorkspace;
  csrfToken: string;
  expiresAt: Date;
  tokenHash: string;
}

export interface IssuedSession {
  token: string;
  response: SessionResponse;
}

/** Internal only: the HTTP layer must return the same response for both outcomes. */
export type RegisterOutcome = "created" | "unavailable";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokensMatch(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function toSessionResponse(context: Pick<AuthContext, "user" | "workspace" | "csrfToken" | "expiresAt">): SessionResponse {
  return { user: context.user, workspace: context.workspace, csrfToken: context.csrfToken, expiresAt: context.expiresAt.toISOString() };
}

export interface AuthServiceOptions {
  store: AuthStore;
  hasher?: PasswordHasher;
  policy?: Partial<SessionPolicy>;
  now?: () => Date;
  /**
   * Registration never finishes faster than this, so new and already-registered emails take the
   * same time. Should exceed the normal hash + account-creation time. Defaults to 1000 ms.
   */
  registerMinMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(options: AuthServiceOptions) {
  const store = options.store;
  const hasher = options.hasher ?? argon2idHasher;
  const policy: SessionPolicy = { ...DEFAULT_SESSION_POLICY, ...options.policy };
  const now = options.now ?? (() => new Date());
  const cookieName = sessionCookieName(policy.secureCookie);
  const registerMinMs = options.registerMinMs ?? 1_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Verifying against a dummy hash for unknown emails keeps login timing similar for existing and missing accounts.
  let dummyHash: Promise<string> | null = null;
  const dummy = () => (dummyHash ??= hasher.hash(randomToken()));

  async function issue(user: AuthUser, workspace: AuthWorkspace): Promise<IssuedSession> {
    const token = randomToken();
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + policy.ttlMs);
    const idleExpiresAt = new Date(Math.min(createdAt.getTime() + policy.idleMs, expiresAt.getTime()));
    const csrfToken = randomToken();
    await store.createSession({ tokenHash: hashToken(token), userId: user.id, workspaceId: workspace.id, csrfToken, createdAt, expiresAt, idleExpiresAt });
    return { token, response: toSessionResponse({ user, workspace, csrfToken, expiresAt }) };
  }

  /** Revokes a session the client already holds. Used before issuing a new one (prevents session fixation). */
  async function revoke(token: string | undefined): Promise<void> {
    if (token && TOKEN.test(token)) await store.deleteSession(hashToken(token));
  }

  return {
    policy,
    cookieName,

    /**
     * Creates the account if the email is free. An existing account is never modified. No session is
     * issued either way; the caller signs in through `login`, which fails generically.
     */
    async register(input: RegisterInput): Promise<RegisterOutcome> {
      const started = Date.now();
      try {
        const passwordHash = await hasher.hash(input.password);
        const account = await store.createAccount({ name: input.name, email: input.email, passwordHash });
        return account.ok ? "created" : "unavailable";
      } finally {
        const remaining = registerMinMs - (Date.now() - started);
        if (remaining > 0) await sleep(remaining);
      }
    },

    /** Null for any credential failure; callers must not reveal which part was wrong. */
    async login(input: LoginInput, presentedToken?: string): Promise<IssuedSession | null> {
      const credentials = await store.findCredentials(input.email);
      if (!credentials) {
        await hasher.verify(await dummy(), input.password);
        return null;
      }
      if (!(await hasher.verify(credentials.passwordHash, input.password))) return null;
      const workspace = await store.findPersonalWorkspace(credentials.user.id);
      if (!workspace) {
        console.error(`Authentication integrity error: user ${credentials.user.id} has no personal workspace membership.`);
        return null;
      }
      await revoke(presentedToken);
      return issue(credentials.user, workspace);
    },

    /** Resolves session → user → workspace membership. Expired or orphaned sessions are deleted. */
    async authenticate(token: string | undefined): Promise<AuthContext | null> {
      if (!token || !TOKEN.test(token)) return null;
      const tokenHash = hashToken(token);
      const session = await store.findSession(tokenHash);
      if (!session) return null;
      const current = now();
      if (current >= session.expiresAt || current >= session.idleExpiresAt) {
        await store.deleteSession(tokenHash);
        return null;
      }
      const user = await store.findUser(session.userId);
      const workspace = user ? await store.findMembership(session.userId, session.workspaceId) : null;
      if (!user || !workspace) {
        await store.deleteSession(tokenHash);
        return null;
      }
      if (current.getTime() - session.lastSeenAt.getTime() >= policy.touchIntervalMs) {
        const idleExpiresAt = new Date(Math.min(current.getTime() + policy.idleMs, session.expiresAt.getTime()));
        await store.touchSession(tokenHash, current, idleExpiresAt);
      }
      return { user, workspace, csrfToken: session.csrfToken, expiresAt: session.expiresAt, tokenHash };
    },

    async logout(token: string | undefined): Promise<void> {
      await revoke(token);
    },
  };
}

/** Reads one cookie from a raw Cookie header without a parser dependency. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || undefined;
  }
  return undefined;
}
