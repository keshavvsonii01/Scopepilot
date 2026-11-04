import dns from "node:dns";
import { isIP } from "node:net";

export const MONGODB_DNS_SERVERS_VARIABLE = "MONGODB_DNS_SERVERS";

export interface DnsServerConfigurator {
  setServers(servers: readonly string[]): void;
  getServers(): string[];
}

export interface ConfigureMongoDnsOptions {
  dns?: DnsServerConfigurator;
  log?: (message: string) => void;
}

function isValidPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

// Accepts the address forms supported by dns.setServers(): "ip", "ipv4:port" and "[ipv6]:port".
function isValidDnsServer(entry: string): boolean {
  if (isIP(entry)) return true;
  const ipv4WithPort = /^([^:[\]]+):(\d+)$/.exec(entry);
  if (ipv4WithPort) return isIP(ipv4WithPort[1]!) === 4 && isValidPort(ipv4WithPort[2]!);
  const ipv6WithPort = /^\[([^\]]+)\]:(\d+)$/.exec(entry);
  if (ipv6WithPort) return isIP(ipv6WithPort[1]!) === 6 && isValidPort(ipv6WithPort[2]!);
  return false;
}

/**
 * Parses MONGODB_DNS_SERVERS. Returns undefined when unset or blank so the system resolver stays in effect.
 * Invalid entries are reported by position only, so a misplaced secret is never echoed.
 */
export function parseDnsServers(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const entries = value.split(",").map((entry) => entry.trim());
  entries.forEach((entry, index) => {
    if (!isValidDnsServer(entry)) {
      throw new Error(`${MONGODB_DNS_SERVERS_VARIABLE} entry ${index + 1} is not a valid IP address. Use comma-separated IP addresses, for example 8.8.8.8,8.8.4.4.`);
    }
  });
  return entries;
}

/**
 * Applies DNS servers to Node's default resolver (used by the MongoDB driver for SRV/TXT lookups).
 * dns.lookup()/getaddrinfo is unaffected. Must run before the first MongoDB connection.
 */
export function configureMongoDns(servers: readonly string[] | undefined, options: ConfigureMongoDnsOptions = {}): void {
  const resolver = options.dns ?? dns;
  const log = options.log ?? console.log;
  if (!servers || servers.length === 0) {
    log(`MongoDB DNS: ${MONGODB_DNS_SERVERS_VARIABLE} not set; using system DNS resolver.`);
    return;
  }
  resolver.setServers(servers);
  log(`MongoDB DNS: using servers from ${MONGODB_DNS_SERVERS_VARIABLE}: ${resolver.getServers().join(", ")}`);
}
