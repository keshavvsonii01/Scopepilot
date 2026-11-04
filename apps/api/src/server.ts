import { connectDatabase, disconnectDatabase, failStaleQueuedAudits } from "@scopepilot/persistence/audits";
import { ensureAuthIndexes } from "@scopepilot/persistence/auth";
import { configureMongoDns } from "@scopepilot/persistence/dns";
import { createApi } from "./app.js";
import { createAuthService } from "./auth.js";
import { loadApiEnvironment } from "./env.js";
import { createAiServices } from "./interpreter.js";
import * as store from "./store.js";

const environment = loadApiEnvironment();
configureMongoDns(environment.mongoDnsServers);
await connectDatabase(environment.mongoUri);
// Email uniqueness relies on the unique index, so it must exist before the first registration.
await ensureAuthIndexes();
const { interpreter, drafter } = createAiServices(environment.ai);
console.log(interpreter ? `AI interpretation and proposal drafting: Gemini (${interpreter.model}).` : "AI interpretation and proposal drafting: not configured (GEMINI_API_KEY unset).");
const { session } = environment;
console.log(`Sessions: ${session.secureCookie ? "secure" : "non-secure (local HTTP development)"} cookies, ${session.ttlMs / 3_600_000} h lifetime, ${session.idleMs / 3_600_000} h idle timeout.`);
if (environment.legacyDevWorkspaceId) {
  console.warn("SCOPEPILOT_DEV_WORKSPACE_ID is set but no longer used: every request now requires a signed-in user. Records in that workspace stay hidden until claimed with `pnpm --filter @scopepilot/api claim-dev-data`.");
}
const auth = createAuthService({ store, policy: { ttlMs: session.ttlMs, idleMs: session.idleMs, secureCookie: session.secureCookie } });
console.log(environment.proxySecret ? "API access: only requests carrying SCOPEPILOT_PROXY_SECRET (the web proxy) are served." : "API access: open to any caller that can reach this port (SCOPEPILOT_PROXY_SECRET unset). Keep the API on a private network.");
const app = createApi({ auth, trustProxy: session.trustProxy, interpreter, drafter, proxySecret: environment.proxySecret });
const server = app.listen(environment.port, () => console.log(`ScopePilot API listening on ${environment.port}`));
// Fails audits stuck in "queued" (no worker running) so the report stops waiting; the worker runs the same sweep.
const queueSweep = setInterval(() => { failStaleQueuedAudits().catch(() => undefined); }, 60_000);
queueSweep.unref();
const shutdown = () => {
  clearInterval(queueSweep);
  server.close(() => { void disconnectDatabase().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);