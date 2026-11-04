# Audit intelligence (Phase 4)

ScopePilot derives evidence-backed findings from three independent, deterministic analysis modules. These modules use no AI and calculate no aggregate score. Optional AI interpretation of these findings is a separate, later step stored apart from the audit; see [ai-interpretation.md](ai-interpretation.md).

| Module | Package entry | Input | Tool |
|---|---|---|---|
| SEO | `@scopepilot/analysis/seo` | Documents already captured by the crawler (no extra requests) | ScopePilot rules |
| Performance | `@scopepilot/analysis/performance` | Submitted (validated) root URL | Google PageSpeed Insights v5 (Lighthouse + Chrome UX Report) |
| Accessibility | `@scopepilot/analysis/accessibility` (worker: `apps/worker/src/accessibility.ts`) | Each page the crawler loaded, reusing the crawler's browser page | axe-core |

The worker (`apps/worker/src/audit-runner.ts`) runs PageSpeed Insights in parallel with the crawl, runs axe after extraction on each loaded page, then builds `AuditResult.analysis`. Types live in `packages/contracts/src/analysis.ts`.

## Result shape

```ts
AuditResult.analysis = {
  modules: { seo, performance, accessibility }, // ModuleRun<Measurements> each
  findings: AuditFinding[],                      // sorted by severity, then category, URL
}

ModuleRun<M> = { status, measurements: M | null, issues: ModuleIssue[], notes: string[], findingCount }
```

**Measurements** are the raw values reported by each tool (HTTP status, title length, Lighthouse lab metrics and score, CrUX percentiles, axe violations with nodes). **Findings** are derived interpretations. They reference measured values in `evidence` and never replace them.

### Finding

| Field | Meaning |
|---|---|
| `id` | Stable within an audit: `ruleId|url[|strategy]` |
| `category` | `seo` · `performance` · `accessibility` |
| `severity` | `critical` · `high` · `medium` · `low` · `info` (mapping below) |
| `basis` | `measured` (a tool measured it) or `rule-based` (a deterministic rule observed it) |
| `source` | `{ tool, ruleId, version? }` |
| `affectedUrl` | Page the finding applies to |
| `evidence` | Discriminated by `kind`: `page-signal`, `metric`, `lighthouse-audit`, `axe-violation` |
| `explanation`, `remediation`, `references` | Plain-language context and documentation links |

### Module status

| Status | Meaning | Audit effect |
|---|---|---|
| `completed` | Ran over all available inputs | — |
| `partial` | Some inputs failed or data is missing (see `issues`) | audit `partial` |
| `failed` | Produced no usable result | audit `partial` |
| `unavailable` | Not configured (e.g. no `PAGESPEED_API_KEY`) | audit `partial` |
| `skipped` | Not requested (accessibility checks off) | none |

A module failure never removes another module's results. Unexpected exceptions become `failed` with `ANALYSIS_ERROR`. Crawl failures still fail the whole audit, as before Phase 4.

## Severity mappings

- **SEO**: fixed per rule (for example missing title and noindex are `high`, missing meta description is `medium`, title over 60 characters is `low`, and a redirect is `info`). Internal pages and the root returning HTTP ≥ 400 are `high` and `measured`.
- **Performance, lab**: uses Lighthouse's own per-metric score. Below 0.5 is `high`; 0.5 up to (not including) 0.9 is `medium`; 0.9 and above produces no finding.
- **Performance, field**: uses the Chrome UX Report category. `SLOW` is `high`, `AVERAGE` is `medium` and `FAST` produces no finding.
- **Performance, insights**: Lighthouse diagnostics with score below 0.9 and positive estimated savings, at most 8 per strategy. Below 0.5 is `medium`; otherwise `low`.
- **Accessibility**: axe impact maps `critical` → `critical`, `serious` → `high`, `moderate` → `medium`, `minor` → `low`. An unknown impact is `low`.

Severity reflects these documented mappings, not business impact.

## Issue codes

- **SEO**: `PAGE_NOT_LOADED`, `NO_PAGES_LOADED`
- **Performance**: `PAGESPEED_NOT_CONFIGURED`, `PAGESPEED_TIMEOUT`, `PAGESPEED_ABORTED`, `PAGESPEED_NETWORK_ERROR`, `PAGESPEED_RATE_LIMITED`, `PAGESPEED_SERVICE_ERROR`, `PAGESPEED_REQUEST_REJECTED`, `PAGESPEED_INVALID_RESPONSE`, `LIGHTHOUSE_RUNTIME_ERROR`, `LAB_METRICS_MISSING`
- **Accessibility**: `NO_PAGES_ANALYZED`, `AXE_TIMEOUT`, `AXE_FAILED`, `AXE_INVALID_RESULT`, `TIME_BUDGET_EXHAUSTED`
- **Any module**: `ANALYSIS_ERROR`

## Limitations

- Pages are captured with browser JavaScript disabled (security boundary), so SEO and accessibility results cover server-rendered HTML only.
- Only internal pages the crawler requested (up to 4) are checked for HTTP errors. robots.txt and sitemaps are not checked.
- PageSpeed Insights measures only the submitted URL, once per strategy (mobile and desktop when mobile checks are on, otherwise desktop). Lab values vary between runs. Field data appears only when Google has enough real-user data and is labeled `origin` when it is origin-level.
- axe-core detects a subset of accessibility barriers. ScopePilot does not claim WCAG conformance. "Incomplete" rules are stored as needing manual review and are not reported as findings. Iframes are not analyzed.

## Configuration

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `PAGESPEED_API_KEY` | worker | no | Enables performance analysis. Never logged or exposed by the API; redacted from stored error messages. |
