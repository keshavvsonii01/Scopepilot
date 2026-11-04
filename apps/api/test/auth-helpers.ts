import type { AuthUser, AuthWorkspace } from "@scopepilot/contracts/auth";
import type { CreateAccountResult, NewSession, SessionRecord } from "@scopepilot/persistence/auth";
import { randomBytes } from "node:crypto";
import { createAuthService, hashToken, sessionCookieName, type AuthStore, type PasswordHasher, type SessionPolicy } from "../src/auth.js";

/** In-memory AuthStore with the same semantics as the MongoDB implementation (unique email, membership checks). */
export class MemoryAuthStore implements AuthStore {
  users = new Map<string, AuthUser & { passwordHash: string }>();
  workspaces = new Map<string, { id: string; name: string; ownerUserId: string }>();
  memberships: Array<{ userId: string; workspaceId: string }> = [];
  sessions = new Map<string, SessionRecord>();
  fail = false;
  private sequence = 0;

  private nextId(prefix: string) { this.sequence += 1; return `${prefix}${String(this.sequence).padStart(4, "0")}`; }
  private check() { if (this.fail) throw new Error("auth store down"); }

  async createAccount(input: { name: string; email: string; passwordHash: string }): Promise<CreateAccountResult> {
    this.check();
    if ([...this.users.values()].some((user) => user.email === input.email)) return { ok: false, reason: "duplicate" };
    return this.seed({ ...input });
  }

  /** Creates an account directly; `workspaceId` lets tests reuse fixed workspace IDs. */
  seed(input: { name?: string; email?: string; passwordHash?: string; workspaceId?: string }): { ok: true; user: AuthUser; workspace: AuthWorkspace } {
    const user = { id: this.nextId("user-"), name: input.name ?? "Test User", email: input.email ?? `${this.nextId("u")}@example.test`, createdAt: new Date("2026-11-01T00:00:00Z").toISOString(), passwordHash: input.passwordHash ?? "plain:unused" };
    this.users.set(user.id, user);
    const workspaceId = input.workspaceId ?? this.nextId("ws-");
    this.workspaces.set(workspaceId, { id: workspaceId, name: `${user.name}'s workspace`, ownerUserId: user.id });
    this.memberships.push({ userId: user.id, workspaceId });
    const { passwordHash: _hash, ...publicUser } = user;
    return { ok: true, user: publicUser, workspace: { id: workspaceId, name: `${user.name}'s workspace`, kind: "personal", role: "owner" } };
  }

  async findCredentials(email: string) {
    this.check();
    const user = [...this.users.values()].find((candidate) => candidate.email === email);
    if (!user) return null;
    const { passwordHash, ...publicUser } = user;
    return { user: publicUser, passwordHash };
  }

  async findUser(userId: string) {
    this.check();
    const user = this.users.get(userId);
    if (!user) return null;
    const { passwordHash: _hash, ...publicUser } = user;
    return publicUser;
  }

  async findMembership(userId: string, workspaceId: string): Promise<AuthWorkspace | null> {
    this.check();
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace || !this.memberships.some((m) => m.userId === userId && m.workspaceId === workspaceId)) return null;
    return { id: workspace.id, name: workspace.name, kind: "personal", role: "owner" };
  }

  async findPersonalWorkspace(userId: string) {
    this.check();
    const workspace = [...this.workspaces.values()].find((candidate) => candidate.ownerUserId === userId);
    return workspace ? this.findMembership(userId, workspace.id) : null;
  }

  async createSession(session: NewSession) {
    this.check();
    this.sessions.set(session.tokenHash, { userId: session.userId, workspaceId: session.workspaceId, csrfToken: session.csrfToken, createdAt: session.createdAt, lastSeenAt: session.createdAt, expiresAt: session.expiresAt, idleExpiresAt: session.idleExpiresAt });
  }

  async findSession(tokenHash: string) { this.check(); const session = this.sessions.get(tokenHash); return session ? { ...session } : null; }

  async touchSession(tokenHash: string, lastSeenAt: Date, idleExpiresAt: Date) {
    const session = this.sessions.get(tokenHash);
    if (session) this.sessions.set(tokenHash, { ...session, lastSeenAt, idleExpiresAt });
  }

  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }
}

/** Fast, deterministic hasher for tests that are not about hashing. Never use outside tests. */
export const plainHasher: PasswordHasher = {
  hash: async (password) => `plain:${password}`,
  verify: async (passwordHash, password) => passwordHash === `plain:${password}`,
};

export interface TestSession { cookie: string; csrf: string; token: string }

/** Puts a valid session for `userId` straight into the store and returns the headers a browser would send. */
export async function sessionFor(store: MemoryAuthStore, userId: string, workspaceId: string, now = new Date(), policy: Partial<SessionPolicy> = {}): Promise<TestSession> {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const ttl = policy.ttlMs ?? 7 * 24 * 3_600_000;
  await store.createSession({ tokenHash: hashToken(token), userId, workspaceId, csrfToken: csrf, createdAt: now, expiresAt: new Date(now.getTime() + ttl), idleExpiresAt: new Date(now.getTime() + (policy.idleMs ?? 24 * 3_600_000)) });
  return { cookie: `${sessionCookieName(policy.secureCookie ?? false)}=${token}`, csrf, token };
}

/** Auth service plus a signed-in session for a fixed workspace (null → no session). */
export async function testAuth(workspaceId: string | null) {
  const store = new MemoryAuthStore();
  const auth = createAuthService({ store, hasher: plainHasher });
  if (workspaceId === null) return { auth, store, headers: {} as Record<string, string> };
  const { user } = store.seed({ workspaceId });
  const session = await sessionFor(store, user.id, workspaceId);
  return { auth, store, session, headers: { cookie: session.cookie, "x-csrf-token": session.csrf } as Record<string, string> };
}
