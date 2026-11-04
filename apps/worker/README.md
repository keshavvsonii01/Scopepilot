# ScopePilot worker

The worker is the only process that launches Playwright. It claims queued MongoDB audit jobs atomically and records an evidence-only result or explicit failure.

Required environment variables: `MONGODB_URI`. Optional: `MONGODB_DNS_SERVERS` (comma-separated DNS server IPs for MongoDB SRV lookups; see the root README) and `PAGESPEED_API_KEY` (Google PageSpeed Insights key; without it, performance analysis is reported as `unavailable` and audits complete as `partial`). The key is read only by the worker, sent only to the PageSpeed Insights endpoint, and redacted from stored error messages.

Each audit runs the crawl (with axe-core accessibility checks on every loaded page, when requested) and PageSpeed Insights for the submitted URL in parallel, then derives SEO findings from the captured documents. See [docs/audit-intelligence.md](../../docs/audit-intelligence.md) for the findings schema and module statuses.

Tests: `pnpm --filter @scopepilot/worker test` (the real-Chromium axe test is skipped when the Playwright Chromium build is not installed).

Before deployment, install the browser in the worker image with `pnpm --filter @scopepilot/worker exec playwright install --with-deps chromium`.

## Required network isolation

Application-level DNS checks and Playwright request interception are defense in depth, not a complete substitute for network isolation. The worker must run in an isolated network with egress rules that deny loopback, RFC1918/private ranges, link-local ranges, cloud metadata addresses, internal DNS zones, and all non-HTTP(S) outbound traffic. It must not be colocated with trusted internal services.
