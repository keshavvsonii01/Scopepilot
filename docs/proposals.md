# Opportunity selection and proposals

Proposals turn findings from one audit into an editable, client-facing document. They are stored in their own `proposals` collection, scoped to the workspace, and never modify the audit record or its AI interpretation.

## Selecting opportunities

In a completed or partial audit report that has findings, the following items show an **Add to proposal** control:

- each audit finding (`source: "finding"`, `ref` = finding ID);
- each AI-interpreted issue (`source: "ai-issue"`, `ref` such as `I3`);
- each AI-suggested service (`source: "ai-opportunity"`, `ref` such as `O0`).

The selection tray lists every selected item with the findings that support it (title, severity, basis and affected URL). The API resolves selections against the audit's current findings and interpretation, and rejects (`422 INVALID_SELECTION`) any item it cannot match. It also rejects AI items whose finding IDs are not all present in the audit. Opportunities therefore cannot exist without audit evidence.

Each stored `ProposalOpportunity` keeps:

- `findingIds`;
- an `evidence` snapshot of each finding (`findingId`, title, category, severity, basis, affectedUrl);
- for AI items, the `interpretationStartedAt` of the interpretation it came from.

Opportunity IDs are `finding:<findingId>` or `ai-issue:I1@<interpretationStartedAt>`, so regenerating an interpretation never silently re-points an existing proposal.

## Content and provenance

Every editable text item records an `origin`:

| Origin | Meaning |
| --- | --- |
| `rule-based` | Copied from a deterministic finding (for example, a deliverable seeded from a finding's remediation). |
| `ai-suggestion` | Drafted by AI from supplied evidence. Labelled "AI suggestion" in the editor and preview until edited. |
| `user` | Entered or edited by the user. Editing any item changes its origin to `user`. |

Pricing (`currency`, `lineItems[].amount`, `paymentTerms`) is always user-entered and has no AI origin. Totals are computed from line items with amounts, in cents; the total is `null` when nothing has been entered. Milestone durations suggested by AI are shown as "suggested estimate".

## AI drafting

When `GEMINI_API_KEY` is set on the API, `POST /v1/proposals/:id/draft` returns suggestions for the overview, objectives, scope, deliverables and milestones. The prompt contains only the proposal's opportunities and their audit findings.

Each output field is checked against that evidence. Fields are rejected if they contain:

- prices or currency amounts;
- guarantees or ROI/conversion claims;
- compliance claims;
- URLs that are not in the evidence;
- measurements that do not appear in it.

Deliverables must reference known opportunities. Rejected items are counted and reported, not shown.

Suggestions are not saved by the API. The studio adds them as `ai-suggestion` items without overwriting existing text, and they persist only when the user saves. Drafting requires saved changes first, so the draft matches the stored opportunities.

## Saving and concurrency

`PUT /v1/proposals/:id` replaces the editable content. The request includes:

- `revision`;
- `opportunityIds` (the opportunities to keep, in order);
- optional `addSelections`.

If another save happened first, the API returns `409 PROPOSAL_CONFLICT` with the current proposal. The studio then offers two choices: load the latest version, or keep your edits and overwrite on the next save.

Content is validated with the shared contract in `@scopepilot/contracts/proposal`, both in the browser before saving and on the API. The checks are:

- length limits;
- unique item IDs;
- three-letter currency;
- non-negative amounts with at most two decimals;
- email and http(s) website;
- ISO dates;
- deliverable links must point to opportunities in the proposal.

## Not included

These are not included: PDF export, sending, e-signatures, CRM or email features, proposal deletion or duplication, AI rewrite/expand of individual fields, and AI-generated pricing. The proposal `status` (draft, sent, accepted, rejected) is set manually and nothing is sent or tracked.
