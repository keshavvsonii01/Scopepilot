# Zero-cost initial deployment

This guide deploys the existing three-process architecture without changing it:

| Process | Host | Public? |
| --- | --- | --- |
| web (Next.js + `/api/v1/*` proxy) | Render Free web service | yes, browsers use only this origin |
| api (Express) | separate Render Free web service | URL is public, but answers `404` to anything except the web proxy |
| worker (Playwright) | Oracle Cloud Always Free Ubuntu VM | no inbound ports except SSH |
| database | existing MongoDB Atlas cluster | IP allowlist |

```text
Browser ──HTTPS──▶ web.onrender.com ──HTTPS + shared secret──▶ api.onrender.com ──▶ Atlas ◀── Oracle VM worker
```

Facts below were checked against Render, Oracle and Playwright documentation when this guide was written. Items that could not be verified are listed under [Unverified items](#unverified-items-check-after-the-first-deploy).

## 1. Secure exposure of a public API

Render Free web services cannot receive private-network traffic, so the API must have a public URL. CORS does not protect it: CORS only restricts what browsers let scripts read, and any non-browser client can call the API directly. ScopePilot does not rely on CORS. The API sends no CORS headers, and the browser never calls it.

The API is protected by a shared secret known only to the two servers:

- Generate one value with `openssl rand -hex 32` (at least 32 characters). Set it as `SCOPEPILOT_PROXY_SECRET` on **both** the web and API services.
- The web proxy sends it in `x-scopepilot-proxy-secret` on every upstream request. The API compares SHA-256 digests in constant time.
- The API answers every request without the correct secret with `404 {"error":"NOT_FOUND"}`, including probes of real routes, so it does not reveal which routes exist.
- With the secret set, login and registration rate limits use the browser address that the web proxy sends in `x-scopepilot-client-ip`. `X-Forwarded-For` and `API_TRUST_PROXY` are ignored for rate limiting. This header is only trusted on requests that carry the secret, so it cannot be spoofed from outside.
- Session cookies (`__Host-scopepilot_session`), CSRF tokens and origin checks are unchanged. The cookie is set by the web origin through the proxy and is never sent to the API host by the browser.

If the secret leaks, rotate it on both services at the same time. Requests fail with `404` until both have the new value.

## 2. Render services

Create both services from the same repository. Use the **same region** for both, and keep the root directory as the repository root.

Render's default Node.js version is 24. The repository pins major version `24` in `.node-version`.

Use `npx --yes pnpm@11.25.0` (the version in `package.json` `packageManager`) so the build does not depend on how Render provides pnpm.

**Do not** set `NODE_ENV=production` as a Render environment variable. During install, pnpm would then skip the devDependencies that the build needs (TypeScript, esbuild, Next.js build tooling). The start commands set it instead; `next build` and `next start` set it themselves.

### API service

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npx --yes pnpm@11.25.0 install --frozen-lockfile && npx --yes pnpm@11.25.0 --filter @scopepilot/api build` |
| Start command | `cd apps/api && NODE_ENV=production node --enable-source-maps dist/server.js` |
| Health check path | leave empty (every API route needs the secret, so a health check would get `404`) |

Environment variables:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Atlas connection string for a least-privilege database user |
| `SCOPEPILOT_PROXY_SECRET` | the shared secret |
| `GEMINI_API_KEY` | optional; without it, AI features report "not configured" |
| `GEMINI_MODEL` | optional; defaults to `gemini-3.8-flash` |
| `SESSION_TTL_HOURS`, `SESSION_IDLE_HOURS` | optional; defaults `168` and `24` |

Do not set `PORT` (Render provides it), `MONGODB_DNS_SERVERS` (Linux system DNS resolves SRV records) or `SCOPEPILOT_DEV_WORKSPACE_ID` (development only).

On startup the log should say that API access is restricted to the web proxy. The log never prints the secret.

### Web service

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npx --yes pnpm@11.25.0 install --frozen-lockfile && npx --yes pnpm@11.25.0 --filter @scopepilot/web build` |
| Start command | `cd apps/web && npx next start` |

Environment variables:

| Variable | Value |
| --- | --- |
| `SCOPEPILOT_API_URL` | the API's public URL, e.g. `https://scopepilot-api.onrender.com` (no trailing slash needed) |
| `SCOPEPILOT_PROXY_SECRET` | the same shared secret |
| `SCOPEPILOT_ALLOWED_ORIGINS` | the web's public origin, e.g. `https://scopepilot.onrender.com` (and any custom domain) |
| `SCOPEPILOT_API_TIMEOUT_MS` | `75000`, so a request that wakes a sleeping API does not time out |

### Render Free limits that affect ScopePilot

- **Sleep:** a free web service spins down after 15 minutes without inbound traffic. Waking takes about a minute. The first request after idle time can be slow twice: once for the web service, and again when the web proxy wakes the API. `SCOPEPILOT_API_TIMEOUT_MS=75000` covers the API wake-up. AI requests use the larger of this value and 90 s.
- **Hours:** 750 free instance-hours per month per workspace, shared by both services. Time spun down does not count. Keeping both awake 24/7 would need about 1,488 hours, so do not add keep-alive pings to both. Exceeding the quota suspends all free services until the next month.
- **In-memory state:** a restart or spin-down resets the in-memory rate-limit counters. Sessions are stored in MongoDB and survive.
- **SMTP:** outbound SMTP ports are blocked. ScopePilot does not send email.

## 3. MongoDB Atlas network access

Add these entries to the Atlas IP access list:

- **Render API outbound ranges:** listed in the Render dashboard under the API service → **Connect** → **Outbound**. These ranges are shared by all Render services in the region, so the allowlist limits exposure but does not isolate ScopePilot. A strong database password remains essential.
- **Oracle VM:** its reserved public IP.

`0.0.0.0/0` also works but removes network-level protection. Avoid it.

The web service does not connect to MongoDB.

## 4. Oracle Cloud worker (ARM64)

### Compatibility checked before choosing the shape

| Component | ARM64 (aarch64) Linux status |
| --- | --- |
| Node.js 24 | official `linux-arm64` builds; NodeSource packages for Ubuntu arm64 |
| Playwright Chromium (`playwright` 1.64.1) | supported on Linux arm64 for Ubuntu 22.04 and 24.04. Chrome and Edge channels are not; ScopePilot launches the bundled Chromium |
| esbuild 0.28.2 (build only) | ships `@esbuild/linux-arm64` |
| mongoose, axe-core, other runtime dependencies | pure JavaScript |

### Shape

Use **`VM.Standard.A1.Flex`** (Ampere, ARM64) with **Ubuntu 24.04**, either 1 OCPU / 6 GB or the full Always Free 2 OCPU / 12 GB. Headless Chromium needs more memory than the 1 GB `VM.Standard.E2.1.Micro` provides.

Always Free limits and risks:

- A1 capacity is 2 OCPU / 12 GB in total, in your home region only.
- The minimum boot volume is 47 GB, within the 200 GB free block storage.
- Creation can fail with "out of host capacity"; retry later or in another availability domain.
- **Idle reclamation:** Oracle may reclaim an Always Free instance when, over 7 days, CPU (95th percentile), network and memory utilisation are all below 20%. A worker that mostly polls can meet this. Oracle's documentation does not confirm whether upgrading to Pay-As-You-Go exempts the instance. Monitor the instance and keep the setup reproducible from this guide.

### Network

- Ingress: SSH (22) only, ideally restricted to your IP. The worker accepts no inbound connections.
- Reserve a public IP and add it to the Atlas access list.

### Setup

As a sudo-capable user:

```bash
sudo apt-get update && sudo apt-get install -y git ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo useradd --system --create-home --shell /usr/sbin/nologin scopepilot
sudo install -d -o scopepilot -g scopepilot /opt/scopepilot
sudo -u scopepilot git clone <repository-url> /opt/scopepilot
cd /opt/scopepilot
sudo -u scopepilot npx --yes pnpm@11.25.0 install --frozen-lockfile
# OS libraries for Chromium (needs root), then the browser itself as the service user:
sudo apps/worker/node_modules/.bin/playwright install-deps chromium
sudo -u scopepilot env PLAYWRIGHT_BROWSERS_PATH=/opt/scopepilot/.playwright \
  apps/worker/node_modules/.bin/playwright install chromium
sudo -u scopepilot npx --yes pnpm@11.25.0 --filter @scopepilot/worker build
```

A private repository needs a deploy key or token for `git clone`.

Create the environment file:

```bash
sudo install -d -m 750 /etc/scopepilot
sudo install -m 600 /dev/null /etc/scopepilot/worker.env
sudo nano /etc/scopepilot/worker.env
```

```ini
MONGODB_URI=<atlas connection string>
PAGESPEED_API_KEY=<optional>
```

Install and start the service from [`deploy/oracle/scopepilot-worker.service`](../deploy/oracle/scopepilot-worker.service):

```bash
sudo cp /opt/scopepilot/deploy/oracle/scopepilot-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now scopepilot-worker
journalctl -u scopepilot-worker -f
```

The unit restarts the worker if it exits. It sends `SIGTERM` on stop and allows 150 s, longer than the worker's 120 s drain of in-flight audits.

### Updating the worker

```bash
cd /opt/scopepilot
sudo -u scopepilot git pull
sudo -u scopepilot npx --yes pnpm@11.25.0 install --frozen-lockfile
sudo -u scopepilot npx --yes pnpm@11.25.0 --filter @scopepilot/worker build
sudo systemctl restart scopepilot-worker
```

If the Playwright version changes, run both `playwright install` commands again with the same paths as in setup.

## 5. Verify after the first deploy

1. Open the API URL directly in a browser and try `/api/v1/auth/session`. Both should return `404`.
2. Register, log in, and start an audit through the web URL.
3. Confirm the worker log shows the audit being claimed and completed.
4. **Rate-limit isolation:** from one network, submit wrong passwords until the login limit returns `429`. From a different network (for example mobile data), log in normally. If the second network is also blocked, Render is adding an extra proxy hop and all users share one bucket; see below.

## Unverified items (check after the first deploy)

- **Client IP behind Render:** the web proxy uses the last `X-Forwarded-For` entry it receives as the browser address. Render's exact hop layout was not confirmed. Step 4 above checks it.
- **Request URL seen by Next.js on Render:** `SCOPEPILOT_ALLOWED_ORIGINS` is set to the public origin so state-changing requests are accepted even if Next.js sees an internal URL.
- **pnpm on Render:** not relied on; the commands use `npx pnpm@11.25.0`.
- **Oracle reclamation:** whether Pay-As-You-Go accounts are exempt is not stated in Oracle's documentation.
