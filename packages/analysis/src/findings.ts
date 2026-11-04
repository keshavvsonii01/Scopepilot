import type { AuditFinding, FindingSeverity, ModuleRun } from "@scopepilot/contracts/analysis";

export interface ModuleResult<M> {
  run: ModuleRun<M>;
  findings: AuditFinding[];
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function compareFindings(a: AuditFinding, b: AuditFinding): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.category.localeCompare(b.category) || a.affectedUrl.localeCompare(b.affectedUrl) || a.id.localeCompare(b.id);
}

export function findingId(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join("|");
}

export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export function moduleResult<M>(run: Omit<ModuleRun<M>, "findingCount">, findings: AuditFinding[] = []): ModuleResult<M> {
  return { run: { ...run, findingCount: findings.length }, findings };
}

/** Runs a module and converts an unexpected exception into a failed module instead of failing the audit. */
export function guardModule<M>(work: () => ModuleResult<M>, notes: string[] = []): ModuleResult<M> {
  try { return work(); }
  catch { return moduleResult<M>({ status: "failed", measurements: null, issues: [{ code: "ANALYSIS_ERROR", message: "The analysis module failed unexpectedly. No findings were produced." }], notes }); }
}
