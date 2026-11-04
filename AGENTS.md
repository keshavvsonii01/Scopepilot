# ScopePilot — Agent Instructions

You are working on ScopePilot, an AI-powered website intelligence and proposal-generation product for freelance web developers, independent designers, and small digital agencies.

## Product goal
Help users turn a prospect's public website into an evidence-backed website audit, understandable improvement opportunities, and an editable client-ready development proposal.

The core workflow is:
Discover prospect → Analyze website → Understand findings → Select opportunities → Build proposal → Export PDF.

## Non-negotiable design direction
Use the supplied Stitch exports as visual references, not as production code to paste blindly. Preserve the visual identity while reducing clutter and improving hierarchy during implementation.

- Paper: `#F2F0EA`
- Ink: `#171A19`
- Acid lime: `#8CFF69`
- Electric blue: `#D9E7FF`
- Amber: `#E8A45D`
- Structural line: `#D8D4CA`
- Display type: Space Grotesk or Satoshi
- Body type: Inter or Geist
- Technical labels: JetBrains Mono

Art direction: premium technical/editorial creative-tech product; asymmetric layouts, confident typography, restrained color, crisp surfaces, meaningful data visualization. Avoid generic AI SaaS templates, purple gradients, repetitive card grids, excessive glassmorphism, decorative charts, and unnecessary floating icons.

## Motion principles
Motion must communicate state, hierarchy, or interaction. It must not delay the user.
Priorities:
1. Marketing homepage: clipped/staggered headline reveal and a polished website-inspection preview with a scanning line and evidence markers.
2. Live analysis: progress transitions driven by actual backend job states; no fake progress or fabricated terminal logs.
3. Report/dashboard/proposal: subtle tab, expand/collapse, selection, count and preview transitions.
Use CSS and Motion for React for most interactions. Use GSAP/ScrollTrigger only if the marketing scroll choreography genuinely benefits. Respect `prefers-reduced-motion`.

## V1 pages
1. Marketing homepage
2. Authentication (sign up, sign in, password recovery)
3. Workspace dashboard
4. New audit submission
5. Live analysis/progress
6. Audit report
7. AI opportunity analysis
8. Proposal studio
9. Proposal preview/history
10. Settings and usage

## V1 functionality
- User registration and authentication.
- Submit a public HTTP/HTTPS website URL.
- Crawl the homepage plus up to three relevant internal pages (maximum four pages per audit).
- Capture desktop/mobile screenshots where feasible.
- Extract page title, metadata, headings, canonical/robots information, links, image attributes and selected page structure.
- Run Google PageSpeed Insights measurements.
- Run selected axe-core accessibility checks.
- Inspect mobile viewport behavior and obvious overflow/layout issues.
- Store normalized, evidence-backed findings.
- Use Gemini or OpenAI to explain findings, describe potential business relevance, recommend fixes, and suggest services/opportunities.
- Let users select findings for a proposal.
- Proposal fields are editable: client details, overview, objectives, selected findings, deliverables, timeline, pricing and terms.
- Pricing and timelines must be manually editable. Clearly label AI-generated estimates as suggestions.
- Export a polished PDF.
- Save audits and proposals and allow users to revisit them.
- Basic usage limits and account settings.

## Evidence and truthfulness
- Deterministic tools collect measurements and findings; AI interprets the evidence.
- Never invent audit findings, scores, affected URLs, performance data, business outcomes, conversion lifts, revenue impact, customer counts, or ROI.
- Never claim the crawler reproduced a bug or verified something it did not test.
- Distinguish measured values, rule-based observations, AI interpretations, and user-entered values.
- Any aggregate opportunity score must have a documented, transparent formula; do not average unrelated metrics into a misleading score.

## Explicitly out of scope for V1
CRM, client portals, automated outreach/email, competitor analysis, team collaboration, recurring audits, e-signatures, automated contract workflows, complex subscription billing, and unverified ROI/revenue forecasting.

## Technical direction
Preferred stack:
- Frontend: Next.js + TypeScript + Tailwind CSS + shadcn/ui.
- Backend: Node.js + Express.
- Database: MongoDB + Mongoose.
- Browser inspection: Playwright.
- Performance: Google PageSpeed Insights API.
- Accessibility: axe-core.
- AI interpretation: Gemini or OpenAI API.
- PDF generation: React PDF or an equivalent reliable server-side PDF approach.
- A separate worker/process for long-running browser scans; do not run Playwright scans inside Vercel serverless request handlers.

Adapt to the repository if it already has a working setup. Inspect before changing dependencies or restructuring.

## Security requirements
Public URL scanning is an SSRF-sensitive feature. Validate protocols, resolve and block loopback/private/link-local/reserved IP ranges, re-check redirects and DNS resolution, block cloud metadata endpoints, restrict ports, cap page count/time/response size, and isolate browser execution. Do not expose API keys to the browser. Add authentication, authorization, validation, rate limits and usage controls.

## Implementation approach
- First inspect the repository, package manager, existing code, and Stitch exports.
- Do not overwrite existing work without understanding it.
- Build reusable design tokens and components before duplicating page styles.
- Implement the real user journey progressively; avoid static mock data masquerading as live metrics.
- Keep components accessible, responsive, and testable.
- Make focused changes and run relevant lint/typecheck/tests after each milestone.
- Before adding libraries, check whether the existing stack already solves the problem.
