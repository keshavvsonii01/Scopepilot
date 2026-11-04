import { parseDnsServers } from "@scopepilot/persistence/dns";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`ScopePilot worker startup configuration error: ${name} is required. Add it to apps/worker/.env or the service environment.`);
  return value;
}

function dnsServers(value: string | undefined): string[] | undefined {
  try { return parseDnsServers(value); }
  catch (error) { throw new Error(`ScopePilot worker startup configuration error: ${(error as Error).message}`); }
}

export const workerEnvironment = {
  mongoUri: required("MONGODB_URI"),
  mongoDnsServers: dnsServers(process.env.MONGODB_DNS_SERVERS),
  /** Optional. Server-side only; never logged or returned by the API. */
  pageSpeedApiKey: process.env.PAGESPEED_API_KEY?.trim() || undefined,
};
