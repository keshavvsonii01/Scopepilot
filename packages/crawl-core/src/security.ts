import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const ALLOWED_PORTS = new Set([80, 443]);

export class UnsafeUrlError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "UnsafeUrlError"; }
}

export interface DnsResolver { resolve(hostname: string): Promise<string[]>; }
export const systemDnsResolver: DnsResolver = { async resolve(hostname) { return (await lookup(hostname, { all: true, verbatim: true })).map((record) => record.address); } };

function ipv4Octets(address: string): number[] | null {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const value = mapped?.[1] ?? address;
  if (isIP(value) !== 4) return null;
  return value.split(".").map(Number);
}

export function isBlockedIp(address: string): boolean {
  const ipv4 = ipv4Octets(address);
  if (ipv4) {
    const [a, b] = ipv4;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) || a === 255;
  }
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) !== 6) return true;
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8");
}

export function normalizeCrawlUrl(input: string | URL): URL {
  const url = new URL(input);
  url.hash = "";
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url;
}

export interface ValidateTargetOptions { resolver?: DnsResolver; rootOrigin?: string; }

export async function validateCrawlTarget(input: string | URL, options: ValidateTargetOptions = {}): Promise<URL> {
  let url: URL;
  try { url = normalizeCrawlUrl(input); } catch { throw new UnsafeUrlError("INVALID_URL", "A complete URL is required."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("UNSUPPORTED_PROTOCOL", "Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("CREDENTIALS_NOT_ALLOWED", "URLs with credentials are not allowed.");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port) || (url.protocol === "https:" && port !== 443) || (url.protocol === "http:" && port !== 80)) throw new UnsafeUrlError("PORT_NOT_ALLOWED", "Only ports 80 and 443 are allowed.");
  if (options.rootOrigin && url.origin !== options.rootOrigin) throw new UnsafeUrlError("CROSS_ORIGIN", "Crawling is limited to the submitted origin.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname.toLowerCase() === "localhost" || hostname.endsWith(".localhost")) throw new UnsafeUrlError("LOCALHOST_BLOCKED", "Localhost targets are not allowed.");
  const addresses = isIP(hostname) ? [hostname] : await (options.resolver ?? systemDnsResolver).resolve(hostname);
  if (!addresses.length) throw new UnsafeUrlError("DNS_EMPTY", "The hostname did not resolve to an address.");
  if (addresses.some(isBlockedIp)) throw new UnsafeUrlError("PRIVATE_ADDRESS", "The hostname resolves to a blocked network address.");
  return url;
}

export async function validateRedirectTarget(location: string, currentUrl: string, rootOrigin: string, resolver?: DnsResolver): Promise<URL> {
  return validateCrawlTarget(new URL(location, currentUrl), { rootOrigin, resolver });
}
