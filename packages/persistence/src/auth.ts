import type { AuthUser, AuthWorkspace, WorkspaceKind, WorkspaceRole } from "@scopepilot/contracts/auth";
import mongoose, { type Model, Schema, Types } from "mongoose";

/**
 * Accounts, workspaces, workspace membership and server-side sessions.
 *
 * Audits, interpretations and proposals keep referencing workspaces by `workspaceId` (string). New
 * workspaces use ObjectId hex strings, so they can never collide with legacy development workspace
 * IDs such as "local-development-workspace".
 */

export interface StoredUser {
  _id: Types.ObjectId;
  name: string;
  /** Normalized (trimmed, lower-cased). Unique. */
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredWorkspace {
  _id: Types.ObjectId;
  name: string;
  kind: WorkspaceKind;
  ownerUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** One row per (workspace, user). Personal workspaces have exactly one owner membership; teams can add more later. */
export interface StoredMembership {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
}

/** Only a SHA-256 hash of the session token is stored; the raw token lives solely in the HTTP-only cookie. */
export interface StoredSession {
  _id: Types.ObjectId;
  tokenHash: string;
  userId: Types.ObjectId;
  workspaceId: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  /** Absolute expiry. A TTL index removes the document after this time. */
  expiresAt: Date;
  /** Sliding idle expiry; refreshed on use. */
  idleExpiresAt: Date;
}

export interface NewSession {
  tokenHash: string;
  userId: string;
  workspaceId: string;
  csrfToken: string;
  createdAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date;
}

export interface SessionRecord {
  userId: string;
  workspaceId: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  idleExpiresAt: Date;
}

export type CreateAccountResult =
  | { ok: true; user: AuthUser; workspace: AuthWorkspace }
  | { ok: false; reason: "duplicate" };

const userSchema = new Schema<StoredUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true });

const workspaceSchema = new Schema<StoredWorkspace>({
  name: { type: String, required: true },
  kind: { type: String, enum: ["personal"], required: true },
  ownerUserId: { type: Schema.Types.ObjectId, required: true, index: true },
}, { timestamps: true });

const membershipSchema = new Schema<StoredMembership>({
  workspaceId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  role: { type: String, enum: ["owner"], required: true },
}, { timestamps: true });
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

const sessionSchema = new Schema<StoredSession>({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  workspaceId: { type: String, required: true },
  csrfToken: { type: String, required: true },
  createdAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  idleExpiresAt: { type: Date, required: true },
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function cached<T>(name: string, schema: Schema<T>, collection: string): () => Model<T> {
  return () => (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema, collection);
}

const users = cached("User", userSchema, "users");
const workspaces = cached("Workspace", workspaceSchema, "workspaces");
const memberships = cached("WorkspaceMembership", membershipSchema, "workspace_memberships");
const sessions = cached("Session", sessionSchema, "sessions");

export function toAuthUser(record: Pick<StoredUser, "_id" | "name" | "email" | "createdAt">): AuthUser {
  return { id: String(record._id), name: record.name, email: record.email, createdAt: record.createdAt.toISOString() };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;
}

/** Ensures unique indexes exist before relying on them for email uniqueness. */
export async function ensureAuthIndexes(): Promise<void> {
  await Promise.all([users().init(), workspaces().init(), memberships().init(), sessions().init()]);
}

/**
 * Creates a user, their personal workspace and the owner membership. If any later step fails the
 * earlier documents are removed so a half-created account cannot sign in.
 */
export async function createAccount(input: { name: string; email: string; passwordHash: string }): Promise<CreateAccountResult> {
  let user: StoredUser;
  try { user = (await users().create(input)).toObject(); }
  catch (error) {
    if (isDuplicateKey(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
  const workspaceId = new Types.ObjectId();
  try {
    await workspaces().create({ _id: workspaceId, name: `${input.name}'s workspace`, kind: "personal", ownerUserId: user._id });
    await memberships().create({ workspaceId, userId: user._id, role: "owner" });
  } catch (error) {
    await Promise.allSettled([memberships().deleteMany({ userId: user._id }), workspaces().deleteOne({ _id: workspaceId }), users().deleteOne({ _id: user._id })]);
    throw error;
  }
  return { ok: true, user: toAuthUser(user), workspace: { id: String(workspaceId), name: `${input.name}'s workspace`, kind: "personal", role: "owner" } };
}

export async function findCredentials(email: string): Promise<{ user: AuthUser; passwordHash: string } | null> {
  const record = await users().findOne({ email }).lean<StoredUser>();
  return record ? { user: toAuthUser(record), passwordHash: record.passwordHash } : null;
}

export async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  if (!Types.ObjectId.isValid(userId)) return;
  await users().updateOne({ _id: userId }, { $set: { passwordHash } });
}

export async function findUser(userId: string): Promise<AuthUser | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const record = await users().findById(userId).lean<StoredUser>();
  return record ? toAuthUser(record) : null;
}

/** The workspace a user may act in, verified through membership. Null when they are not a member. */
export async function findMembership(userId: string, workspaceId: string): Promise<AuthWorkspace | null> {
  if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(workspaceId)) return null;
  const membership = await memberships().findOne({ userId, workspaceId }).lean<StoredMembership>();
  if (!membership) return null;
  const workspace = await workspaces().findById(workspaceId).lean<StoredWorkspace>();
  return workspace ? { id: String(workspace._id), name: workspace.name, kind: workspace.kind, role: membership.role } : null;
}

/** The user's personal (owned) workspace. */
export async function findPersonalWorkspace(userId: string): Promise<AuthWorkspace | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const workspace = await workspaces().findOne({ ownerUserId: userId, kind: "personal" }).sort({ createdAt: 1 }).lean<StoredWorkspace>();
  return workspace ? findMembership(userId, String(workspace._id)) : null;
}

export async function createSession(session: NewSession): Promise<void> {
  await sessions().create({ ...session, userId: new Types.ObjectId(session.userId), lastSeenAt: session.createdAt });
}

export async function findSession(tokenHash: string): Promise<SessionRecord | null> {
  const record = await sessions().findOne({ tokenHash }).lean<StoredSession>();
  return record ? { userId: String(record.userId), workspaceId: record.workspaceId, csrfToken: record.csrfToken, createdAt: record.createdAt, lastSeenAt: record.lastSeenAt, expiresAt: record.expiresAt, idleExpiresAt: record.idleExpiresAt } : null;
}

export async function touchSession(tokenHash: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
  await sessions().updateOne({ tokenHash }, { $set: { lastSeenAt, idleExpiresAt } });
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await sessions().deleteOne({ tokenHash });
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  if (!Types.ObjectId.isValid(userId)) return;
  await sessions().deleteMany({ userId });
}
