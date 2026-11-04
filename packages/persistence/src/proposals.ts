import {
  proposalTotal,
  type Proposal,
  type ProposalContent,
  type ProposalOpportunity,
  type ProposalStatus,
  type ProposalSummary,
} from "@scopepilot/contracts/proposal";
import mongoose, { type Model, Schema, type Types } from "mongoose";

/**
 * Proposals live in their own collection. They reference an audit and its finding IDs but never
 * write to the audit or interpretation records.
 */
export interface StoredProposal {
  _id: Types.ObjectId;
  workspaceId: string;
  auditId: string;
  auditUrl: string;
  status: ProposalStatus;
  revision: number;
  opportunities: ProposalOpportunity[];
  content: ProposalContent;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProposal {
  workspaceId: string;
  auditId: string;
  auditUrl: string;
  opportunities: ProposalOpportunity[];
  content: ProposalContent;
}

export interface ProposalChanges {
  id: string;
  workspaceId: string;
  /** The revision the caller edited. The update is refused if the stored revision differs. */
  revision: number;
  status: ProposalStatus;
  opportunities: ProposalOpportunity[];
  content: ProposalContent;
}

export type ProposalUpdateResult =
  | { kind: "updated"; proposal: Proposal }
  | { kind: "conflict"; current: Proposal }
  | { kind: "not-found" };

export const PROPOSAL_LIST_LIMIT = 100;

const proposalSchema = new Schema<StoredProposal>({
  workspaceId: { type: String, required: true },
  auditId: { type: String, required: true },
  auditUrl: { type: String, required: true },
  status: { type: String, enum: ["draft", "sent", "accepted", "rejected"], required: true, default: "draft" },
  revision: { type: Number, required: true, default: 1 },
  opportunities: { type: Schema.Types.Mixed, default: [] },
  content: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true, minimize: false });
proposalSchema.index({ workspaceId: 1, updatedAt: -1 });
proposalSchema.index({ workspaceId: 1, auditId: 1, updatedAt: -1 });

function model(): Model<StoredProposal> {
  return (mongoose.models.Proposal as Model<StoredProposal> | undefined) ?? mongoose.model<StoredProposal>("Proposal", proposalSchema);
}

export function toProposal(record: StoredProposal): Proposal {
  return {
    id: record._id.toString(),
    auditId: record.auditId,
    auditUrl: record.auditUrl,
    status: record.status,
    revision: record.revision,
    opportunities: record.opportunities ?? [],
    ...record.content,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toProposalSummary(record: StoredProposal): ProposalSummary {
  return {
    id: record._id.toString(),
    auditId: record.auditId,
    title: record.content.title,
    businessName: record.content.client.businessName,
    status: record.status,
    opportunityCount: record.opportunities?.length ?? 0,
    currency: record.content.pricing.currency,
    total: proposalTotal(record.content.pricing),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function createProposal(proposal: NewProposal): Promise<Proposal> {
  const created = await model().create({ ...proposal, status: "draft", revision: 1 });
  return toProposal(created.toObject<StoredProposal>());
}

export async function getProposalForWorkspace(id: string, workspaceId: string): Promise<Proposal | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const record = await model().findOne({ _id: id, workspaceId }).lean<StoredProposal>();
  return record ? toProposal(record) : null;
}

export async function listProposalsForWorkspace(workspaceId: string, auditId?: string): Promise<ProposalSummary[]> {
  const records = await model()
    .find({ workspaceId, ...(auditId ? { auditId } : {}) }, { workspaceId: 1, auditId: 1, status: 1, opportunities: 1, "content.title": 1, "content.client.businessName": 1, "content.pricing": 1, createdAt: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(PROPOSAL_LIST_LIMIT)
    .lean<StoredProposal[]>();
  return records.map(toProposalSummary);
}

/** Saves edits with optimistic concurrency: a stale revision returns the current proposal instead. */
export async function updateProposal(changes: ProposalChanges): Promise<ProposalUpdateResult> {
  if (!mongoose.isValidObjectId(changes.id)) return { kind: "not-found" };
  const updated = await model().findOneAndUpdate(
    { _id: changes.id, workspaceId: changes.workspaceId, revision: changes.revision },
    { $set: { status: changes.status, opportunities: changes.opportunities, content: changes.content }, $inc: { revision: 1 } },
    { new: true },
  ).lean<StoredProposal>();
  if (updated) return { kind: "updated", proposal: toProposal(updated) };
  const current = await getProposalForWorkspace(changes.id, changes.workspaceId);
  return current ? { kind: "conflict", current } : { kind: "not-found" };
}
