import mongoose from "mongoose";

/**
 * Explicit, operator-run migration of records created under a legacy development workspace (before
 * authentication existed) into a real user's workspace. Nothing calls this automatically: legacy
 * records stay invisible to every account until an operator claims them for a named user.
 */

/** Collections whose documents are scoped by a string `workspaceId`. */
export const WORKSPACE_SCOPED_COLLECTIONS = ["audits", "auditinterpretations", "proposals"] as const;

export type ScopedCollection = (typeof WORKSPACE_SCOPED_COLLECTIONS)[number];

export interface ClaimPlan {
  fromWorkspaceId: string;
  toWorkspaceId: string;
  counts: Record<ScopedCollection, number>;
  applied: boolean;
}

export interface ClaimOptions {
  fromWorkspaceId: string;
  toWorkspaceId: string;
  /** Without this the call only counts matching records (dry run). */
  apply: boolean;
}

export function validateClaim(options: Pick<ClaimOptions, "fromWorkspaceId" | "toWorkspaceId">): string | null {
  if (!options.fromWorkspaceId.trim()) return "A source workspace ID is required.";
  if (!options.toWorkspaceId.trim()) return "A target workspace ID is required.";
  if (options.fromWorkspaceId === options.toWorkspaceId) return "Source and target workspaces must differ.";
  // Real workspaces are ObjectIds; refusing them as a source prevents moving one user's data to another.
  if (/^[a-f0-9]{24}$/i.test(options.fromWorkspaceId)) return "The source must be a legacy development workspace ID, not a user workspace.";
  return null;
}

export async function claimLegacyWorkspaceData(options: ClaimOptions): Promise<ClaimPlan> {
  const error = validateClaim(options);
  if (error) throw new Error(error);
  const counts = {} as Record<ScopedCollection, number>;
  for (const name of WORKSPACE_SCOPED_COLLECTIONS) {
    const collection = mongoose.connection.collection(name);
    counts[name] = options.apply
      ? (await collection.updateMany({ workspaceId: options.fromWorkspaceId }, { $set: { workspaceId: options.toWorkspaceId } })).modifiedCount
      : await collection.countDocuments({ workspaceId: options.fromWorkspaceId });
  }
  return { fromWorkspaceId: options.fromWorkspaceId, toWorkspaceId: options.toWorkspaceId, counts, applied: options.apply };
}

/** Lists workspace IDs on scoped records that do not look like real (ObjectId) workspaces. */
export async function listLegacyWorkspaceIds(): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const name of WORKSPACE_SCOPED_COLLECTIONS) {
    const groups = await mongoose.connection.collection(name).aggregate<{ _id: string; count: number }>([
      { $match: { workspaceId: { $not: /^[a-f0-9]{24}$/i } } },
      { $group: { _id: "$workspaceId", count: { $sum: 1 } } },
    ]).toArray();
    for (const group of groups) totals[group._id] = (totals[group._id] ?? 0) + group.count;
  }
  return totals;
}
