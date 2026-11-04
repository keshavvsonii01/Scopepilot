import { QUEUED_AUDIT_TIMEOUT_MS, type AuditResult, type AuditStatus, type AuditStatusResponse, type AuditSubmission, type AuditSummary } from "@scopepilot/contracts/audit";
import mongoose, { type Model, Schema } from "mongoose";

export interface StoredAudit {
  workspaceId: string;
  input: Omit<AuditSubmission, "workspaceId">;
  status: AuditStatus;
  result?: AuditResult;
  failure?: { code: string; message: string };
  leaseId?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const auditSchema = new Schema<StoredAudit>({
  workspaceId: { type: String, required: true, index: true },
  input: { type: Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["queued", "running", "partial", "completed", "failed"], required: true, index: true },
  result: { type: Schema.Types.Mixed },
  failure: { code: String, message: String },
  leaseId: String,
  startedAt: Date,
  completedAt: Date,
}, { timestamps: true, minimize: false });

auditSchema.index({ status: 1, createdAt: 1 });
auditSchema.index({ workspaceId: 1, createdAt: -1 });

function model(): Model<StoredAudit> { return (mongoose.models.Audit as Model<StoredAudit> | undefined) ?? mongoose.model<StoredAudit>("Audit", auditSchema); }

export async function connectDatabase(uri: string): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000, maxPoolSize: 10 });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

function toStatus(record: StoredAudit & { _id: unknown }): AuditStatusResponse {
  return { id: String(record._id), status: record.status, createdAt: record.createdAt.toISOString(), startedAt: record.startedAt?.toISOString(), completedAt: record.completedAt?.toISOString(), failure: record.failure, result: record.result };
}

export async function createAudit(submission: AuditSubmission): Promise<AuditStatusResponse> {
  const { workspaceId, ...input } = submission;
  const record = await model().create({ workspaceId, input, status: "queued" });
  return toStatus(record.toObject());
}

export async function getAuditForWorkspace(id: string, workspaceId: string): Promise<AuditStatusResponse | null> {
  const record = await model().findOne({ _id: id, workspaceId }).lean();
  return record ? toStatus(record) : null;
}

export interface AuditSummarySource {
  _id: unknown;
  input: { url: string };
  status: AuditStatus;
  createdAt: Date;
  result?: { analysis?: { findings?: unknown[] } };
}

export function toAuditSummary(record: AuditSummarySource): AuditSummary {
  let domain = record.input.url;
  try { domain = new URL(record.input.url).hostname; } catch { /* keep the stored URL */ }
  const findings = record.result?.analysis?.findings;
  return { id: String(record._id), domain, createdAt: record.createdAt.toISOString(), status: record.status, ...(Array.isArray(findings) ? { findingCount: findings.length } : {}) };
}

/** Newest audits first. Projects only finding IDs so screenshots and evidence are not loaded. */
export async function listAuditsForWorkspace(workspaceId: string, limit = 20): Promise<AuditSummary[]> {
  const records = await model()
    .find({ workspaceId }, { "input.url": 1, status: 1, createdAt: 1, "result.analysis.findings.id": 1 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<AuditSummarySource[]>();
  return records.map(toAuditSummary);
}

export async function claimNextAudit(leaseId: string): Promise<(StoredAudit & { _id: unknown }) | null> {
  return model().findOneAndUpdate({ status: "queued" }, { $set: { status: "running", leaseId, startedAt: new Date() } }, { sort: { createdAt: 1 }, new: true }).lean();
}

/**
 * An audit is `partial` when the crawl reported warnings or any analysis module did not fully run
 * (`partial`, `failed`, or `unavailable`). Modules the user did not request (`skipped`) do not affect status.
 */
export function deriveAuditStatus(result: AuditResult): "completed" | "partial" {
  const crawlIncomplete = result.warnings.length > 0 || result.pages.some((page) => page.warnings.length > 0);
  const analysisIncomplete = result.analysis ? Object.values(result.analysis.modules).some((module) => module.status === "partial" || module.status === "failed" || module.status === "unavailable") : false;
  return crawlIncomplete || analysisIncomplete ? "partial" : "completed";
}

export async function completeAudit(id: unknown, leaseId: string, result: AuditResult): Promise<void> {
  const status: AuditStatus = deriveAuditStatus(result);
  await model().updateOne({ _id: id, status: "running", leaseId }, { $set: { status, result, completedAt: new Date() }, $unset: { leaseId: 1 } });
}

export async function failAudit(id: unknown, leaseId: string, code: string, message: string): Promise<void> {
  await model().updateOne({ _id: id, status: "running", leaseId }, { $set: { status: "failed", failure: { code, message }, completedAt: new Date() }, $unset: { leaseId: 1 } });
}

export async function failExpiredAudits(maxRuntimeMs: number): Promise<void> {
  await model().updateMany({ status: "running", startedAt: { $lt: new Date(Date.now() - maxRuntimeMs) } }, { $set: { status: "failed", failure: { code: "JOB_TIMEOUT", message: "The inspection exceeded its allowed runtime." }, completedAt: new Date() }, $unset: { leaseId: 1 } });
}

export const QUEUE_TIMEOUT_FAILURE = {
  code: "QUEUE_TIMEOUT",
  message: `No audit worker picked up this audit within ${QUEUED_AUDIT_TIMEOUT_MS / 60_000} minutes. The audit service may be unavailable; submit the audit again later.`,
} as const;

/** Filter for audits that have waited in the queue longer than `maxQueuedMs`. */
export function staleQueuedFilter(now: Date, maxQueuedMs = QUEUED_AUDIT_TIMEOUT_MS) {
  return { status: "queued" as const, createdAt: { $lt: new Date(now.getTime() - maxQueuedMs) } };
}

/** Fails audits no worker claimed in time. Run by the API as well, so it still happens when no worker is running. */
export async function failStaleQueuedAudits(maxQueuedMs = QUEUED_AUDIT_TIMEOUT_MS): Promise<number> {
  const result = await model().updateMany(staleQueuedFilter(new Date(), maxQueuedMs), { $set: { status: "failed", failure: QUEUE_TIMEOUT_FAILURE, completedAt: new Date() } });
  return result.modifiedCount;
}

export type ClaimedAudit = StoredAudit & { _id: unknown };
