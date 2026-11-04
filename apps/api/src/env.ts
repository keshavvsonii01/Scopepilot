import { parseDnsServers } from "@scopepilot/persistence/dns";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

type Env = Record<string, string | undefined>;

function configError(message: string): Error {
  return new Error(`ScopePilot API startup configuration error: ${message}`);
}

function optional(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function required(env: Env, name: string): string {
  const value = optional(env, name);
  if (!value) throw configError(`${name} is required. Add it to apps/api/.env or the service environment.`);
  return value;
}

function port(value: string | undefined): number {
  if (!value) return 4000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw configError("PORT must be an integer from 1 to 65535.");
  return parsed;
}

function dnsServers(value: string | undefined): string[] | undefined {
  try { return parseDnsServers(value); }
  catch (error) { throw configError((error as Error).message); }
}

function hours(env: Env, name: string, fallback: number): number {
  const value = optional(env, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24 * 90) throw configError(`${name} must be a number of hours greater than 0 and at most 2160.`);
  return parsed;
}

function bool(env: Env, name: string): boolean | undefined {
  const value = optional(env, name)?.toLowerCase();
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw configError(`${name} must be true or false.`);
}

/** Express `trust proxy` value: true/false, a hop count, or a comma-separated list of addresses, subnets or presets. */
function trustProxy(value: string | undefined): boolean | number | string {
  if (!value) return "loopback";
  if (value === "true") return true;
  if (value === "false") return false;
  return /^\d+$/.test(value) ? Number(value) : value;
}

/** Session cookie and lifetime settings. Secure cookies are mandatory when NODE_ENV=production. */
export function sessionEnvironment(env: Env = process.env) {
  const production = env.NODE_ENV === "production";
  const secureCookie = bool(env, "SESSION_COOKIE_SECURE") ?? production;
  if (production && !secureCookie) throw configError("SESSION_COOKIE_SECURE cannot be false in production.");
  const ttlHours = hours(env, "SESSION_TTL_HOURS", 168);
  const idleHours = Math.min(hours(env, "SESSION_IDLE_HOURS", 24), ttlHours);
  return { production, secureCookie, ttlMs: ttlHours * 3_600_000, idleMs: idleHours * 3_600_000, trustProxy: trustProxy(optional(env, "API_TRUST_PROXY")) };
}

export function loadApiEnvironment(env: Env = process.env) {
  const geminiApiKey = optional(env, "GEMINI_API_KEY");
  return {
    mongoUri: required(env, "MONGODB_URI"),
    mongoDnsServers: dnsServers(env.MONGODB_DNS_SERVERS),
    port: port(env.PORT),
    session: sessionEnvironment(env),
    /** Retired pre-authentication setting. Reported at startup if still present; never used for access. */
    legacyDevWorkspaceId: optional(env, "SCOPEPILOT_DEV_WORKSPACE_ID"),
    /** Optional. Without a key, AI interpretation reports a "not configured" state. */
    ai: geminiApiKey ? { apiKey: geminiApiKey, model: optional(env, "GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL } : null,
  };
}
