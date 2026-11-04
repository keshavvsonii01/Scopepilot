# ScopePilot API

The API accepts authenticated audit requests, performs pre-queue URL/DNS validation, and persists a queued job. It never runs Playwright.

Required environment variables: `MONGODB_URI`. Optional: `MONGODB_DNS_SERVERS` (comma-separated DNS server IPs for MongoDB SRV lookups; see the root README), `GEMINI_API_KEY` and `GEMINI_MODEL` (AI interpretation and proposal drafting; see [docs/ai-interpretation.md](../../docs/ai-interpretation.md)). Sessions: `SESSION_COOKIE_SECURE`, `SESSION_TTL_HOURS`, `SESSION_IDLE_HOURS`, `API_TRUST_PROXY` (see `.env.example` and [docs/authentication.md](../../docs/authentication.md)).

## Authentication

Every route except `/v1/auth/register`, `/v1/auth/login` and `/v1/auth/logout` requires a valid session cookie (`scopepilot_session`, or `__Host-scopepilot_session` when secure). The API resolves session → user → workspace membership and scopes every query to that workspace; workspace IDs supplied by the browser are ignored. Missing or expired sessions get `401 AUTH_REQUIRED`; resources in another workspace get the same `404` as resources that do not exist. Non-GET requests also need the session's CSRF token in `x-csrf-token` (`403 CSRF_INVALID`). `503 AUTH_UNAVAILABLE` means the session store could not be reached.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/auth/register` | `{ name, email, password }` → `202` `{ status: "accepted", message }`, identical and with no cookie whether the email is new or already registered; existing accounts are never changed. Sign in afterwards with `/v1/auth/login`. Errors: `400 INVALID_REGISTRATION` (`field`), `429 RATE_LIMITED` (10/hour/IP). |
| `POST` | `/v1/auth/login` | `{ email, password }` → `200` `SessionResponse` + a new session cookie (any presented session is revoked). Errors: `400 INVALID_LOGIN`, `401 INVALID_CREDENTIALS` (same for unknown email and wrong password), `429 RATE_LIMITED` (30/15 min/IP; 10 failures/15 min/email). |
| `POST` | `/v1/auth/logout` | Deletes the session server-side and clears the cookie (`204`). Requires `x-csrf-token` while the session is valid. |
| `GET` | `/v1/auth/session` | Current `SessionResponse` (`{ user, workspace, csrfToken, expiresAt }`) or `401`. |
| `GET` | `/v1/account` | `{ user, workspace }`. |

`pnpm --filter @scopepilot/api claim-dev-data` moves pre-authentication development data into one account's workspace (dry run unless `--apply`).

## Workspace routes

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/audits` | Validate and queue an audit (`202`). |
| `GET` | `/v1/audits` | List the latest 20 audits for the workspace (`{ audits }`). |
| `GET` | `/v1/audits/:id` | Audit status and results. |
| `GET` | `/v1/audits/:id/interpretation` | `{ configured, interpretation }`; `interpretation` is `null` until generated. |
| `POST` | `/v1/audits/:id/interpretation` | Generate (or regenerate) the AI interpretation synchronously. Returns `200` with the stored record, including failed attempts. Errors: `409 AUDIT_NOT_READY`, `422 ANALYSIS_UNAVAILABLE`, `422 NO_FINDINGS`, `503 AI_NOT_CONFIGURED`, `409 INTERPRETATION_IN_PROGRESS`, `429` rate limit. |
| `GET` | `/v1/proposals?auditId=` | List the latest 100 proposal summaries for the workspace, optionally for one audit (`{ proposals }`). |
| `POST` | `/v1/proposals` | Create a proposal from `{ auditId, selections, title?, client? }` (`201`, `{ proposal, aiDraftConfigured }`). Errors: `400 INVALID_PROPOSAL`, `404 AUDIT_NOT_FOUND`, `409 AUDIT_NOT_READY`, `422 INVALID_SELECTION`. |
| `GET` | `/v1/proposals/:id` | `{ proposal, aiDraftConfigured }`. |
| `PUT` | `/v1/proposals/:id` | Replace editable content with `{ revision, status, content, opportunityIds, addSelections }`. Errors: `400 INVALID_PROPOSAL`, `404 PROPOSAL_NOT_FOUND`, `409 PROPOSAL_CONFLICT` (body includes `current`), `409 AUDIT_UNAVAILABLE`, `422 UNKNOWN_OPPORTUNITY` / `INVALID_SELECTION`. |
| `POST` | `/v1/proposals/:id/draft` | AI drafting suggestions from the proposal's opportunities (not saved). Errors: `503 AI_NOT_CONFIGURED`, `409 AUDIT_UNAVAILABLE`, `422 NO_OPPORTUNITIES` / `NO_FINDINGS` / `AI_INVALID_OUTPUT`, `429` (with `Retry-After`), `502`, `504`. |

`pnpm --filter @scopepilot/api test` runs the route tests with in-memory fakes. With `SCOPEPILOT_TEST_MONGODB_URI` set (and optionally `SCOPEPILOT_TEST_MONGODB_DB`, default `scopepilot_test`), it also runs `test/two-users.integration.test.ts`: two real accounts against MongoDB with Argon2id, cleaned up afterwards.
