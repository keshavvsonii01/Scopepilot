# Authentication, authorization and workspaces

ScopePilot uses email/password accounts with server-managed sessions. Each account owns a private personal workspace. Audits, AI interpretations and proposals belong to exactly one workspace.

## Data model (MongoDB)

| Collection | Key fields | Indexes |
| --- | --- | --- |
| `users` | `email` (normalized: trimmed, lower-case), `name`, `passwordHash` (Argon2id), `createdAt`, `updatedAt` | unique `email` |
| `workspaces` | `_id`, `name`, `kind: "personal"`, `ownerUserId` | `ownerUserId` |
| `workspace_memberships` | `workspaceId`, `userId`, `role: "owner"` | unique `{ workspaceId, userId }`, `userId` |
| `sessions` | `tokenHash` (SHA-256 of the cookie token), `userId`, `workspaceId`, `csrfToken`, `createdAt`, `lastSeenAt`, `idleExpiresAt`, `expiresAt` | unique `tokenHash`, TTL on `expiresAt`, `userId` |

Existing collections (`audits`, `auditinterpretations`, `proposals`) are unchanged: they already carry a string `workspaceId`. New workspaces use ObjectId hex strings, so they can never collide with the legacy `local-development-workspace` ID.

Membership is a separate collection so team workspaces can be added later without changing the scoping of audit or proposal queries. In V1, registration creates the user, a personal workspace and an owner membership. If any step fails, the records already created are removed.

## Sessions

- **Registration** never creates a session. It returns the same `202` response whether or not the email is already registered, and never changes an existing account. The web app then signs in with the same credentials.
- **Login** creates a 32-byte random token. The browser receives it as an HTTP-only cookie (`scopepilot_session`). When secure cookies are enabled, the cookie is `__Host-scopepilot_session`, which forces `Secure`, `Path=/` and no `Domain`. The cookie is `SameSite=Lax`, with `Max-Age` set to the session lifetime.
- **Storage:** only the token's SHA-256 hash is stored, so a database leak does not expose usable cookies. No signing secret is needed.
- **Expiry:** sessions have an absolute lifetime (`SESSION_TTL_HOURS`, default 7 days) and an inactivity timeout (`SESSION_IDLE_HOURS`, default 24 hours). Activity extends the idle window at most every 5 minutes. Expired sessions are deleted when presented and by MongoDB's TTL index.
- **Login** revokes any session the browser presented and issues a new token. This prevents session fixation.
- **Logout** deletes the session server-side and clears the cookie. The old cookie is rejected from then on.
- **CSRF:**
  - Each session has a random CSRF token, returned in the `SessionResponse` and held only in browser memory (never in `localStorage` or `sessionStorage`).
  - Every non-GET request to a protected route must send it as `x-csrf-token`. It is compared in constant time.
  - The Next.js proxy also rejects writes whose `Origin` is not the site's own origin or listed in `SCOPEPILOT_ALLOWED_ORIGINS`. This includes login and registration, which blocks login CSRF.
- **Passwords:**
  - Hashed with Argon2id via `@node-rs/argon2`, using prebuilt binaries and the OWASP-recommended defaults (m=19 MiB, t=2, p=1).
  - Policy: 12–128 characters, not only spaces, and not equal to the email.
  - Unknown emails are verified against a dummy hash, so response timing does not reveal whether an account exists.

## Authorization

Every protected request resolves, in order:

1. the session cookie,
2. the session record (exists, not expired, not idle),
3. the user,
4. the user's membership of the session's workspace,
5. the resource through `workspaceId`.

Every persistence query filters on the resolved `workspaceId`. Workspace IDs sent by the browser are ignored.

| Situation | Response |
| --- | --- |
| No session, or an invalid or expired session | `401 AUTH_REQUIRED`; an invalid cookie is cleared. |
| Resource in another workspace | The same `404` (`AUDIT_NOT_FOUND`, `PROPOSAL_NOT_FOUND`, …) and body as a resource that does not exist. |
| Missing or wrong CSRF token on a write | `403 CSRF_INVALID` |
| Session store unreachable | `503 AUTH_UNAVAILABLE` (fails closed). |

The web app adds two layers on top of this, for user experience only; the API remains the authority:

- `src/proxy.ts` redirects requests to `/workspace/*` that have no session cookie to `/login?next=…`.
- The workspace layout validates the cookie against `GET /v1/auth/session` before rendering.

`next` is restricted to `/workspace…` paths.

The old `SCOPEPILOT_DEV_WORKSPACE_ID` fallback is gone. If it is still set, the API only logs a warning that it is unused.

## Rate limiting and brute force

| Limit | Default |
| --- | --- |
| Registration | 10 per hour per IP |
| Login | 30 per 15 minutes per IP |
| Failed logins per email (hashed key, including unknown emails) | 10 per 15 minutes |
| Other routes | Existing per-IP read/write limits |

Login and registration responses never say whether an email exists:

- **Login** returns the same `401 INVALID_CREDENTIALS` for an unknown email and a wrong password. Unknown emails are checked against a dummy Argon2id hash so timing matches.
- **Registration** returns the same `202 { status: "accepted", message }` with no cookie for new and already-registered emails. An existing account is never modified. Both paths are padded to a minimum duration (1 s by default) so the account-creation writes do not show up in response timing.

Client IPs come from `X-Forwarded-For`, which the API trusts only from `API_TRUST_PROXY` (default: loopback, meaning the local Next.js server). The Next.js proxy forwards the right-most hop it received.

## Migrating existing development data

Records created before accounts existed live in the `local-development-workspace` workspace. No account can see them. They are never assigned automatically.

```bash
# List legacy workspace IDs and record counts
pnpm --filter @scopepilot/api claim-dev-data

# Dry run: show what would move to this account's workspace
pnpm --filter @scopepilot/api claim-dev-data -- --email you@example.com

# Move them
pnpm --filter @scopepilot/api claim-dev-data -- --email you@example.com --apply
```

How the command behaves:

- It updates `workspaceId` in `audits`, `auditinterpretations` and `proposals`. Nothing else changes.
- It refuses to move data out of a real (ObjectId) workspace.
- It refuses to run with `NODE_ENV=production` unless `--allow-production` is given.
- Use `--from <id>` for a different legacy workspace ID.

To discard legacy data instead, delete the records with that `workspaceId`.

## Forgot password

Deferred. A safe reset flow needs verified email delivery, which ScopePilot does not have yet. The sign-in page says so.

## Known limitations

- Email addresses are not verified. Because of that, someone can still learn that an email is registered in two steps: register it with a password they choose, then try to sign in with that password. This can't be closed without email verification. It is rate-limited by IP and by email, and it never grants access to the existing account.
- The registration timing padding hides the extra account-creation writes only while hashing plus writing finishes within the 1 s minimum.
- There is no MFA, password change, password reset or session list.
- Rate limits are held in memory per API process. Use a shared store if you run several API instances.
- If the Next.js server is exposed directly, without a reverse proxy, clients can supply their own `X-Forwarded-For`. That weakens the per-IP limits; the per-email login limit still applies.
- V1 has one personal workspace per user and no invitations or roles beyond `owner`.
