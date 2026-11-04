import { randomUUID } from "node:crypto";
import { InspectionTimeoutError } from "@scopepilot/crawl-core/execution";
import { UnsafeUrlError } from "@scopepilot/crawl-core/security";
import { claimNextAudit, completeAudit, connectDatabase, disconnectDatabase, failAudit, failExpiredAudits, failStaleQueuedAudits } from "@scopepilot/persistence/audits";
import { configureMongoDns } from "@scopepilot/persistence/dns";
import { runAudit } from "./audit-runner.js";
import { workerEnvironment } from "./env.js";
import { createWorkerLoop } from "./lifecycle.js";

const leaseId = randomUUID();
/** Lease reaper limit. Must exceed the crawl budget (90 s) and the parallel PageSpeed request limit (60 s). */
const JOB_TIMEOUT_MS = 120_000;

configureMongoDns(workerEnvironment.mongoDnsServers);
console.log(workerEnvironment.pageSpeedApiKey ? "PageSpeed Insights: API key configured." : "PageSpeed Insights: PAGESPEED_API_KEY not set; performance analysis will be reported as unavailable.");
await connectDatabase(workerEnvironment.mongoUri);

async function processOne(): Promise<void> {
  await failExpiredAudits(JOB_TIMEOUT_MS);
  await failStaleQueuedAudits();
  if (loop.stopping) return;
  const audit = await claimNextAudit(leaseId);
  if (!audit) return;
  try { await completeAudit(audit._id, leaseId, await runAudit({ ...audit.input, workspaceId: audit.workspaceId }, { pageSpeedApiKey: workerEnvironment.pageSpeedApiKey })); }
  catch (error) {
    const code = error instanceof InspectionTimeoutError ? "JOB_TIMEOUT" : error instanceof UnsafeUrlError ? error.code : "INSPECTION_FAILED";
    const message = error instanceof Error ? error.message : "The inspection failed unexpectedly.";
    await failAudit(audit._id, leaseId, code, message);
  }
}

const loop = createWorkerLoop({
  tick: processOne,
  intervalMs: 1_000,
  drainTimeoutMs: JOB_TIMEOUT_MS,
  onError: (error) => console.error(`Worker tick failed: ${error instanceof Error ? error.name : "unknown error"}`),
});

async function shutdown(signal: string): Promise<void> {
  if (loop.stopping) return;
  console.log(`${signal} received: no new audits will be claimed; waiting for ${loop.inFlight} in-flight audit(s).`);
  const drained = await loop.stop();
  // Undrained audits stay "running" and are failed by the lease reaper (JOB_TIMEOUT) on the next worker start.
  if (!drained) console.warn("Shutdown timed out with audits still running.");
  await disconnectDatabase().catch(() => undefined);
  process.exit(drained ? 0 : 1);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
loop.start();
console.log("ScopePilot worker started; polling for queued audits.");
