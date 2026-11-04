import { AUTH_LIMITS, normalizeEmail, parseLoginInput, parseRegisterInput, safeNextPath, validatePassword } from "@scopepilot/contracts/auth";
import { validateClaim } from "@scopepilot/persistence/migration";
import { describe, expect, it } from "vitest";
import { DEFAULT_LEGACY_WORKSPACE, parseClaimArgs } from "../src/claim-dev-data.js";

describe("auth contracts", () => {
  it("normalizes emails and trims names", () => {
    expect(normalizeEmail("  Mixed@Example.COM ")).toBe("mixed@example.com");
    expect(parseRegisterInput({ name: " Ada ", email: "ADA@example.com", password: "a sufficiently long one" })).toEqual({ ok: true, value: { name: "Ada", email: "ada@example.com", password: "a sufficiently long one" } });
  });

  it("keeps the password exactly as typed", () => {
    const result = parseRegisterInput({ name: "A", email: "a@example.com", password: "  spaced password  " });
    expect(result.ok && result.value.password).toBe("  spaced password  ");
  });

  it("applies the password policy", () => {
    expect(validatePassword("x".repeat(AUTH_LIMITS.passwordMin - 1))).toMatch(/at least/);
    expect(validatePassword("x".repeat(AUTH_LIMITS.passwordMin))).toBeNull();
    expect(validatePassword(" ".repeat(20))).toMatch(/spaces/);
    expect(validatePassword(123)).toMatch(/Enter/);
  });

  it("rejects malformed registration input", () => {
    expect(parseRegisterInput(null)).toMatchObject({ ok: false, field: "body" });
    expect(parseRegisterInput({ name: "A\u0007", email: "a@example.com", password: "long enough pass" })).toMatchObject({ ok: false, field: "name" });
    expect(parseRegisterInput({ name: "A", email: "a@b", password: "long enough pass" })).toMatchObject({ ok: false, field: "email" });
    expect(parseRegisterInput({ name: "x".repeat(81), email: "a@example.com", password: "long enough pass" })).toMatchObject({ ok: false, field: "name" });
  });

  it("does not apply the registration policy at login", () => {
    expect(parseLoginInput({ email: " A@Example.com", password: "short" })).toEqual({ ok: true, value: { email: "a@example.com", password: "short" } });
    expect(parseLoginInput({ email: "a@example.com", password: "" })).toMatchObject({ ok: false, field: "password" });
  });

  it("only allows same-site workspace paths after login", () => {
    expect(safeNextPath("/workspace/audits/abc")).toBe("/workspace/audits/abc");
    expect(safeNextPath("//evil.example/workspace")).toBe("/workspace");
    expect(safeNextPath("https://evil.example")).toBe("/workspace");
    expect(safeNextPath("/\\evil.example")).toBe("/workspace");
    expect(safeNextPath("/login")).toBe("/workspace");
    expect(safeNextPath(undefined)).toBe("/workspace");
  });
});

describe("legacy development data migration", () => {
  it("defaults to a dry run of the legacy development workspace", () => {
    expect(parseClaimArgs([])).toEqual({ from: DEFAULT_LEGACY_WORKSPACE, apply: false, allowProduction: false });
    expect(parseClaimArgs(["--", "--email", " Me@Example.com ", "--apply"])).toEqual({ email: "me@example.com", from: DEFAULT_LEGACY_WORKSPACE, apply: true, allowProduction: false });
    expect(() => parseClaimArgs(["--email"])).toThrow(/requires a value/);
    expect(() => parseClaimArgs(["--bogus"])).toThrow(/Unknown argument/);
  });

  it("refuses to move data out of a real user workspace", () => {
    expect(validateClaim({ fromWorkspaceId: "local-development-workspace", toWorkspaceId: "6ae9aa6fd4f927d836bcc3be" })).toBeNull();
    expect(validateClaim({ fromWorkspaceId: "6ae9aa6fd4f927d836bcc3be", toWorkspaceId: "6ae9aa6fd4f927d836bcc3bf" })).toMatch(/legacy/);
    expect(validateClaim({ fromWorkspaceId: "same", toWorkspaceId: "same" })).toMatch(/differ/);
    expect(validateClaim({ fromWorkspaceId: " ", toWorkspaceId: "x" })).toMatch(/source/);
  });
});
