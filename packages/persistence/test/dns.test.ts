import dns from "node:dns";
import { describe, expect, it, vi } from "vitest";
import { configureMongoDns, parseDnsServers, type DnsServerConfigurator } from "../src/dns.js";

function fakeResolver(initial: string[] = ["192.168.1.1"]) {
  let servers = [...initial];
  const resolver = {
    setServers: vi.fn((next: readonly string[]) => { servers = [...next]; }),
    getServers: () => [...servers],
  } satisfies DnsServerConfigurator;
  return resolver;
}

describe("parseDnsServers", () => {
  it("returns undefined when the variable is absent or blank", () => {
    expect(parseDnsServers(undefined)).toBeUndefined();
    expect(parseDnsServers("")).toBeUndefined();
    expect(parseDnsServers("   ")).toBeUndefined();
  });

  it("parses comma-separated addresses and trims whitespace", () => {
    expect(parseDnsServers("8.8.8.8,8.8.4.4")).toEqual(["8.8.8.8", "8.8.4.4"]);
    expect(parseDnsServers(" 1.1.1.1 , 2606:4700:4700::1111 ")).toEqual(["1.1.1.1", "2606:4700:4700::1111"]);
  });

  it("accepts explicit ports", () => {
    expect(parseDnsServers("8.8.8.8:53,[2001:4860:4860::8888]:53")).toEqual(["8.8.8.8:53", "[2001:4860:4860::8888]:53"]);
  });

  it.each(["dns.google", "8.8.8.8,", "8.8.8.8,,8.8.4.4", "999.1.1.1", "8.8.8.8:0", "8.8.8.8:70000", "2001:4860::8888:53x"])("rejects invalid input %j", (value) => {
    expect(() => parseDnsServers(value)).toThrow(/MONGODB_DNS_SERVERS entry \d+ is not a valid IP address/);
  });

  it("never echoes the invalid value in the error", () => {
    let message = "";
    try { parseDnsServers("mongodb+srv://user:hunter2@cluster.example.net"); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/entry 1/);
    expect(message).not.toContain("hunter2");
  });
});

describe("configureMongoDns", () => {
  it("leaves the system resolver untouched when no servers are configured", () => {
    const resolver = fakeResolver();
    const log = vi.fn();
    configureMongoDns(undefined, { dns: resolver, log });
    configureMongoDns([], { dns: resolver, log });
    expect(resolver.setServers).not.toHaveBeenCalled();
    expect(resolver.getServers()).toEqual(["192.168.1.1"]);
    expect(log).toHaveBeenCalledWith("MongoDB DNS: MONGODB_DNS_SERVERS not set; using system DNS resolver.");
  });

  it("applies configured servers and logs only their addresses", () => {
    const resolver = fakeResolver();
    const log = vi.fn();
    configureMongoDns(["8.8.8.8", "8.8.4.4"], { dns: resolver, log });
    expect(resolver.setServers).toHaveBeenCalledWith(["8.8.8.8", "8.8.4.4"]);
    expect(log).toHaveBeenCalledWith("MongoDB DNS: using servers from MONGODB_DNS_SERVERS: 8.8.8.8, 8.8.4.4");
  });

  it("configures Node's default resolver, including dns.promises, when no resolver is injected", () => {
    const original = dns.getServers();
    try {
      configureMongoDns(["8.8.8.8", "8.8.4.4"], { log: () => undefined });
      expect(dns.getServers()).toEqual(["8.8.8.8", "8.8.4.4"]);
      expect(dns.promises.getServers()).toEqual(["8.8.8.8", "8.8.4.4"]);
    } finally {
      dns.setServers(original);
    }
  });
});
