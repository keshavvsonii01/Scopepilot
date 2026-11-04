import type {
  AuditInterpretation,
  InterpretationContent,
  InterpretationFailureCode,
  InterpretationInputSummary,
  InterpretationProvider,
  InterpretationRejection,
  InterpretationStatus,
} from "@scopepilot/contracts/interpretation";
import { randomUUID } from "node:crypto";
import mongoose, { type Model, Schema } from "mongoose";

/**
 * AI interpretations live in their own collection, keyed by audit. The audit document and its
 * measured `result` are never written by this module.
 */
export interface StoredInterpretation {
  auditId: string;
  workspaceId: string;
  attemptId: string;
  status: InterpretationStatus;
  provider: InterpretationProvider;
  model: string;
  promptVersion: string;
  startedAt: Date;
  completedAt?: Date;
  input?: InterpretationInputSummary;
  content: InterpretationContent | null;
  rejected: InterpretationRejection[];
  uninterpretedRefs: string[];
  failure?: { code: InterpretationFailureCode; message: string; retryAfterSeconds?: number };
}

export interface InterpretationAttempt {
  auditId: string;
  workspaceId: string;
  provider: InterpretationProvider;
  model: string;
  promptVersion: string;
}

export interface InterpretationCompletion {
  status: "completed" | "partial" | "failed";
  input: InterpretationInputSummary;
  content: InterpretationContent | null;
  rejected: InterpretationRejection[];
  uninterpretedRefs: string[];
  failure?: StoredInterpretation["failure"];
}

/** A `generating` record older than this is treated as interrupted (e.g. the API restarted mid-request). */
export const INTERPRETATION_STALE_MS = 3 * 60_000;

const interpretationSchema = new Schema<StoredInterpretation>({
  auditId: { type: String, required: true, unique: true },
  workspaceId: { type: String, required: true, index: true },
  attemptId: { type: String, required: true },
  status: { type: String, enum: ["generating", "completed", "partial", "failed"], required: true },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  promptVersion: { type: String, required: true },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  input: { type: Schema.Types.Mixed },
  content: { type: Schema.Types.Mixed, default: null },
  rejected: { type: Schema.Types.Mixed, default: [] },
  uninterpretedRefs: { type: [String], default: [] },
  failure: { type: Schema.Types.Mixed },
}, { timestamps: true, minimize: false });

function model(): Model<StoredInterpretation> {
  return (mongoose.models.AuditInterpretation as Model<StoredInterpretation> | undefined) ?? mongoose.model<StoredInterpretation>("AuditInterpretation", interpretationSchema);
}

export function toInterpretation(record: StoredInterpretation, now = new Date(), staleMs = INTERPRETATION_STALE_MS): AuditInterpretation {
  const interrupted = record.status === "generating" && now.getTime() - record.startedAt.getTime() > staleMs;
  return {
    auditId: record.auditId,
    status: interrupted ? "failed" : record.status,
    provider: record.provider,
    model: record.model,
    promptVersion: record.promptVersion,
    startedAt: record.startedAt.toISOString(),
    ...(record.completedAt ? { completedAt: record.completedAt.toISOString() } : {}),
    ...(record.input ? { input: record.input } : {}),
    content: record.content ?? null,
    rejected: record.rejected ?? [],
    uninterpretedRefs: record.uninterpretedRefs ?? [],
    ...(interrupted
      ? { failure: { code: "AI_GENERATION_INTERRUPTED" as const, message: "Interpretation did not finish. Generate it again." } }
      : record.failure ? { failure: record.failure } : {}),
  };
}

export async function getInterpretationForWorkspace(auditId: string, workspaceId: string): Promise<AuditInterpretation | null> {
  const record = await model().findOne({ auditId, workspaceId }).lean<StoredInterpretation>();
  return record ? toInterpretation(record) : null;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

/**
 * Atomically marks an interpretation as generating. Returns the attempt ID, or null when another
 * generation for this audit is already in progress. Replaces any previous interpretation.
 */
export async function beginInterpretation(attempt: InterpretationAttempt, now = new Date()): Promise<string | null> {
  const attemptId = randomUUID();
  try {
    await model().findOneAndUpdate(
      { auditId: attempt.auditId, workspaceId: attempt.workspaceId, $or: [{ status: { $ne: "generating" } }, { startedAt: { $lt: new Date(now.getTime() - INTERPRETATION_STALE_MS) } }] },
      {
        $set: { ...attempt, attemptId, status: "generating", startedAt: now, content: null, rejected: [], uninterpretedRefs: [] },
        $unset: { completedAt: 1, failure: 1, input: 1 },
      },
      { upsert: true, new: true },
    );
    return attemptId;
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
}

/** Stores the validated outcome only if this attempt still owns the record. */
export async function completeInterpretation(auditId: string, attemptId: string, outcome: InterpretationCompletion): Promise<AuditInterpretation | null> {
  const record = await model().findOneAndUpdate(
    { auditId, attemptId, status: "generating" },
    {
      $set: { status: outcome.status, input: outcome.input, content: outcome.content, rejected: outcome.rejected, uninterpretedRefs: outcome.uninterpretedRefs, completedAt: new Date(), ...(outcome.failure ? { failure: outcome.failure } : {}) },
      ...(outcome.failure ? {} : { $unset: { failure: 1 } }),
    },
    { new: true },
  ).lean<StoredInterpretation>();
  return record ? toInterpretation(record) : null;
}
