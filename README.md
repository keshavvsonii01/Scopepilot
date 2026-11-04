# ScopePilot

Evidence-backed website intelligence and proposal generation for independent web teams.

## Workspace

- `apps/web` — Next.js marketing and product interface (dashboard, audit submission, audit report, proposal studio)
- `apps/api` — API boundary (audits, AI interpretation, proposals)
- `apps/worker` — isolated audit worker
- `packages/ui` — shared design tokens and interface primitives
- `packages/contracts` — shared data contracts (audits, findings schema, AI interpretation, proposals)
- `packages/analysis` — SEO, performance (PageSpeed Insights) and accessibility (axe-core) analysis modules
- `packages/intelligence` — Gemini-based interpretation of verified findings and evidence-grounded proposal drafting, with output validation
- `packages/persistence` — MongoDB models for users, workspaces, sessions, audits, AI interpretations and proposals

## Commands

```bash
pnpm install

# One time: copy each app's safe template and set MONGODB_URI.
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/worker/.env.example apps/worker/.env
Copy-Item apps/web/.env.example apps/web/.env.local

# Run in separate terminals. Each service loads its own .env automatically.
pnpm dev
pnpm --filter @scopepilot/api dev
pnpm --filter @scopepilot/worker dev

pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

The API and worker use Node's built-in `--env-file-if-exists=.env` support. Their package scripts run from their respective directories, so `apps/api/.env` and `apps/worker/.env` are isolated from one another. Missing `MONGODB_URI` produces a clear startup error without printing secrets.

Optional `MONGODB_DNS_SERVERS` (comma-separated IPs, e.g. `8.8.8.8,8.8.4.4`) makes the API and worker call `dns.setServers()` before connecting, so the MongoDB driver's `mongodb+srv` SRV/TXT lookups use those servers. Use it when Node's resolver fails with `ECONNREFUSED` (seen on some Windows setups) even though `nslookup` works. When unset, system DNS is used. Startup logs show only the active DNS server addresses. This does not affect `dns.lookup()`, which crawl-target validation uses.

Optional worker-only `PAGESPEED_API_KEY` enables Google PageSpeed Insights performance analysis. Without it, audits still run SEO and accessibility analysis and report performance as `unavailable`. Audit findings, measurements and module statuses are documented in [docs/audit-intelligence.md](docs/audit-intelligence.md).

Optional API-only `GEMINI_API_KEY` (and `GEMINI_MODEL`, default `gemini-3.8-flash`) enables AI interpretation of an audit's verified findings. Without it, the report shows AI interpretation as not configured and all measured results remain available. See [docs/ai-interpretation.md](docs/ai-interpretation.md).

Proposals are built from findings and AI recommendations selected in an audit report ("Add to proposal"), edited in the proposal studio at `/workspace/proposals`, and stored separately from audits. The same `GEMINI_API_KEY` enables optional AI drafting suggestions; pricing is always entered by the user. See [docs/proposals.md](docs/proposals.md).

The web app calls same-origin `/api/v1/*`, which a Next.js route handler forwards to the API at `SCOPEPILOT_API_URL` (default `http://localhost:4000`). Open `http://localhost:3000/register` to create an account, then submit audits and view reports in `/workspace`.

Every workspace route requires a signed-in account. Registration creates a personal workspace; audits, AI interpretations and proposals are only visible inside it. Sessions are server-managed HTTP-only cookies with CSRF protection. Data created before accounts existed (`local-development-workspace`) stays hidden until claimed with `pnpm --filter @scopepilot/api claim-dev-data -- --email you@example.com` (dry run; add `--apply`). See [docs/authentication.md](docs/authentication.md).

## Production deployment

ScopePilot runs as three long-lived Node.js processes sharing one MongoDB database:

```text
Browser ──HTTPS──▶ web (Next.js, /api/v1/* proxy) ──HTTP──▶ api (Express) ──▶ MongoDB ◀── worker (Playwright, polls MongoDB)
```

- **web** is the only public service. The browser never calls the API directly; the Next.js route handler forwards the session cookie and CSRF header server-side.
- **api** should be reachable only from the web server (private network or firewall).
- **worker** is a persistent process, not a serverless function. It polls MongoDB for queued audits every second and launches Chromium. Run it under a supervisor that restarts it (systemd, a container restart policy, a PaaS background-worker dyno). On `SIGTERM`/`SIGINT` it stops claiming audits, waits up to 120 s for in-flight audits and disconnects.
- If no worker picks up a queued audit within 15 minutes, the API and the worker both mark it `failed` with code `QUEUE_TIMEOUT`. After one minute in the queue, the report warns that the worker may be offline.

### Build and start

```bash
pnpm install --frozen-lockfile
pnpm --filter @scopepilot/worker install:browsers   # worker host only: Playwright Chromium + OS libraries
pnpm build            # next build for web; typecheck + esbuild bundle for api and worker
NODE_ENV=production pnpm start:web
NODE_ENV=production pnpm start:api
NODE_ENV=production pnpm start:worker
```

`pnpm build` bundles the API into `apps/api/dist/server.js` and the worker into `apps/worker/dist/index.js` (`scripts/bundle-service.mjs`). Workspace `@scopepilot/*` packages are compiled into the bundle. Third-party packages such as `mongoose`, `express` and `playwright` stay external, so they must be installed in production. The build fails if a bundled import is not a dependency of that app. The `start` scripts run `node` on the bundle directly, so SIGTERM reaches the graceful-shutdown handlers; `tsx` is only needed for `dev` and `claim-dev-data`. Each `start` script loads `apps/<app>/.env` only if it exists; platform-provided environment variables work without it. `install:browsers` uses `--with-deps`, which needs root on Debian/Ubuntu. In containers, the `mcr.microsoft.com/playwright` base image already includes these dependencies.

### Environment variables

| Service | Variable | Required | Notes |
| --- | --- | --- | --- |
| api, worker | `MONGODB_URI` | yes | Same database for both. Use a dedicated least-privilege database user. |
| api, worker | `MONGODB_DNS_SERVERS` | no | Comma-separated DNS IPs for `mongodb+srv` lookups. Omit to use system DNS. |
| api | `NODE_ENV=production` | yes | Enables production checks and secure cookies. |
| api | `PORT` | no | Default `4000`. |
| api | `SESSION_COOKIE_SECURE` | no | Always `true` in production; setting it to `false` there stops startup. |
| api | `SESSION_TTL_HOURS`, `SESSION_IDLE_HOURS` | no | Defaults `168` and `24`. |
| api | `API_TRUST_PROXY` | see below | Express `trust proxy` value. Default `loopback`. |
| api | `GEMINI_API_KEY`, `GEMINI_MODEL` | no | AI interpretation and drafting. Without a key they are reported as not configured. The model defaults to `gemini-3.8-flash`. |
| worker | `PAGESPEED_API_KEY` | no | Without it, performance analysis is reported as unavailable. |
| web | `SCOPEPILOT_API_URL` | yes | Internal API base URL, e.g. `http://api.internal:4000`. |
| web | `SCOPEPILOT_ALLOWED_ORIGINS` | no | Extra public origins allowed to make state-changing requests when the public origin differs from the URL Next.js sees. |

Keep every secret in the platform's secret store. Never commit `.env` files; `.gitignore` excludes them and only the `.env.example` placeholders are tracked.

### Proxy trust and rate limiting

Login and registration rate limits are keyed on the client IP. The web proxy forwards one client address in `X-Forwarded-For`: the last hop added by the proxy in front of Next.js. The API trusts that header only from addresses matched by `API_TRUST_PROXY`.

- **Web and API on the same host:** keep the default `loopback`.
- **Separate hosts:** set `API_TRUST_PROXY` to the web server's private address or subnet, e.g. `10.0.0.0/8`, or to a hop count. If you leave it at the default, every user shares the web server's rate-limit bucket.
- **Never** set `API_TRUST_PROXY=true` on an API that is publicly reachable: clients could then spoof their IP.
- The rate-limit store is in memory, per API instance. With several API instances, limits apply per instance and reset on restart.

### Security headers

`apps/web/next.config.ts` sends these headers on every route:
- Content-Security-Policy, with `frame-ancestors 'none'` and `connect-src 'self'`;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy`;
- `Permissions-Policy`;
- HSTS in production.

Scripts are allowed `'unsafe-inline'` because Next.js hydration needs it without a nonce middleware. Serve the web app over HTTPS only.