# AI interpretation (Phase 5)

ScopePilot can ask an AI model to explain an audit's **existing, verified findings** in plain language. The AI never measures anything and never adds findings. Its output is stored separately from the audit, and the audit's measured results are never modified.

## Flow

1. The user opens a finished audit (`completed` or `partial`) and requests an interpretation.
2. The API (`POST /v1/audits/:id/interpretation`) atomically creates an `auditinterpretations` record with status `generating`. Only one attempt per audit runs at a time.
3. `@scopepilot/intelligence` groups findings by category, tool and rule into issue groups `I1…In`. Groups are ordered by severity, then count, and capped at 25, with 4 evidence items per group. It sends them with module statuses and notes to Gemini, requesting JSON that matches a response schema.
4. The response is validated (see below) and the record is completed as `completed`, `partial` or `failed`.
5. The web report shows the interpretation in a separately labelled "AI interpretation" panel. Each interpreted issue links back to the measured findings it explains.

Regenerating replaces the previous interpretation for that audit.

## Validation

AI output is treated as untrusted. Validation happens in two layers:

**Structural validation** (`parseAiInterpretationOutput` in `@scopepilot/contracts/interpretation`):
- A malformed root fails the attempt with `AI_INVALID_OUTPUT`.
- Malformed items are dropped and recorded in `rejected`.
- Length and count limits are enforced.

**Grounding** (`@scopepilot/intelligence`). Text is rejected if it:
- references an issue ref that was not supplied, or a ref that was already interpreted;
- contains a URL that is not in the supplied evidence;
- contains a number with a unit that does not match a supplied measurement (unit conversions and small rounding are tolerated);
- mentions currency amounts;
- makes guarantee or compliance claims ("guaranteed", "will increase revenue", "fully WCAG compliant", …); negated forms are allowed;
- states business relevance without hedging ("may", "could", "might", …).

Rejected items are removed and listed in `rejected` with reasons. Supplied refs that end up uninterpreted are listed in `uninterpretedRefs`. If anything is rejected, the status is `partial`; if nothing valid remains, it is `failed`.

## Failure handling

| Code | Meaning |
| --- | --- |
| `AI_NOT_CONFIGURED` | No `GEMINI_API_KEY` on the API (`503`; nothing stored). |
| `AI_TIMEOUT` | No response within 60 s. |
| `AI_RATE_LIMITED` | Provider returned 429; `retryAfterSeconds` is included when the provider supplied it. |
| `AI_AUTH_FAILED` / `AI_REQUEST_REJECTED` | Invalid key or rejected request. |
| `AI_PROVIDER_ERROR` / `AI_NETWORK_ERROR` | Provider 5xx or network failure. |
| `AI_BLOCKED` / `AI_EMPTY_RESPONSE` / `AI_OUTPUT_TRUNCATED` | Safety block, empty output or token limit. |
| `AI_INVALID_OUTPUT` | Output was not valid JSON or failed validation entirely. |
| `AI_GENERATION_INTERRUPTED` | A `generating` record older than 3 minutes (e.g. API restart) is reported as failed. |

Failures are persisted so the report can show them honestly. Provider error bodies and keys are never stored or returned.

## Environment variables (API only)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | No | — | Enables AI interpretation. Sent only in the `x-goog-api-key` header from the API server; never logged or exposed to the browser. |
| `GEMINI_MODEL` | No | `gemini-3.8-flash` | Gemini model ID. |

The web app needs `SCOPEPILOT_API_URL` (default `http://localhost:4000`) to forward requests to the API; it never holds AI keys.

## Tests

- `packages/intelligence`: issue grouping, grounding rules, fabricated or invalid output, provider failures, timeouts and rate limits.
- `packages/persistence`: interpretation record lifecycle.
- `apps/api`: interpretation routes.
- `apps/web`: proxy and report and AI panel rendering.

An opt-in integration test runs against a real MongoDB database:

```powershell
$env:SCOPEPILOT_TEST_MONGODB_URI = "<connection string>"   # optional: SCOPEPILOT_TEST_MONGODB_DB (default scopepilot_test)
pnpm --filter @scopepilot/persistence test
```

## Limitations

- Grounding is heuristic. Bare numbers without units are not cross-checked, and free text could still describe general consequences beyond the evidence. The UI labels all AI text as interpretation and links it to measured findings.
- Only the top 25 issue groups are sent; omitted groups are reported in the panel.
- Generation is synchronous (up to about 60 s) and limited to 10 requests per 15 minutes per client IP. Behind the web proxy, all browsers share the web server's IP.
- No authentication yet; all requests use the development workspace.
