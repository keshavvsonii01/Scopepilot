# ScopePilot — Product & First-Week Build Specification

## 1. Product summary
ScopePilot is an AI-powered website intelligence and proposal-generation platform for freelance web developers, independent designers and small digital agencies.

It helps a user inspect a prospect's website, discover technical/design improvement opportunities, and turn selected evidence-backed findings into an editable client proposal.

**Positioning:** We are not just selling website audits. We are helping freelancers turn website observations into scoped development opportunities.

**Tagline:** Find what others miss.

## 2. Primary user journey
1. User creates an account.
2. User submits a prospect's public website URL.
3. ScopePilot crawls a controlled number of pages.
4. Deterministic tools collect technical evidence.
5. AI interprets findings and suggests improvements/services.
6. User reviews findings and selects relevant opportunities.
7. User creates and edits a proposal.
8. User exports a professional PDF.
9. Audit and proposal remain in workspace history.

## 3. First-week scope

### Day 1 — Foundation and visual system
- Inspect repository and choose/confirm architecture.
- Configure Next.js + TypeScript frontend and API/backend structure.
- Establish design tokens from the supplied Stitch `DESIGN.md`.
- Build typography, buttons, inputs, badges, navigation and base surfaces.
- Create responsive application shell.
- Start marketing homepage implementation.

### Day 2 — Homepage, workspace and audit submission
- Implement marketing homepage using Stitch design as reference.
- Build authentication screens and workspace shell.
- Build dashboard with actual empty/loading states and recent audits.
- Build new audit form and URL validation.
- Create audit API and persistence model.

### Day 3 — Crawler and deterministic audit
- Implement isolated Playwright worker.
- Limit crawl to homepage + up to three relevant internal pages.
- Extract metadata, headings, links, images and page structure.
- Capture desktop/mobile screenshots where feasible.
- Integrate PageSpeed Insights.
- Integrate axe-core checks.
- Normalize results into consistent schemas.

### Day 4 — Report and AI interpretation
- Build real analysis progress UI driven by backend job state.
- Build audit report UI with evidence, affected page, category and severity.
- Implement AI interpretation grounded in normalized findings.
- Generate business relevance, recommended fix and suggested service.
- Build opportunity selection flow.

### Day 5 — Proposal studio
- Build proposal creation from selected findings.
- Editable client details, overview, objectives, deliverables, timeline, pricing and terms.
- AI writing assistance for proposal sections.
- Live preview.
- Clearly distinguish user-entered prices from optional AI suggestions.

### Day 6 — PDF, history and hardening
- PDF export with polished document layout.
- Audit/proposal history.
- Basic settings and usage limits.
- Validate empty, loading, failure and partial-result states.
- Security review of URL scanner and browser worker.
- Responsive and accessibility pass.

### Day 7 — Beta readiness
- End-to-end testing on real public sites.
- Fix critical issues and improve UI polish.
- Deploy frontend, API and worker appropriately.
- Invite initial beta users.
- Prepare demo and build-in-public launch content.

This is an aggressive target. Prefer a smaller reliable crawler and fewer supported checks over fabricated or unreliable results.

## 4. Page inventory and requirements

### Marketing homepage
- Strong editorial hero and integrated URL CTA.
- Animated website inspection preview.
- Product workflow: URL → audit → opportunities → proposal.
- Explain analysis categories.
- Show honest report/proposal previews.
- Pricing/launch offer only when decided.
- No invented testimonials, customer counts, case studies or performance claims.

### Authentication
- Sign in, sign up, password recovery.
- Keep layout aligned with brand system.

### Dashboard
- New audit CTA.
- Actual total audits, findings and proposals.
- Recent audits with domain, date, status and finding count.
- No fake telemetry, revenue, win rates, team dispatch or arbitrary metrics.

### New audit
- URL input.
- Quick mode (homepage) and standard mode (up to four pages).
- Optional mobile and accessibility checks.
- Explain scan scope and limitations.

### Live analysis
- Show actual job stages/status.
- Browser preview and scanning visualization.
- Progress should be driven by worker events/states, not arbitrary timers.
- Handle queued, running, partial, completed and failed states.

### Audit report
- Website identity, screenshot, audit date and rerun action.
- Separate PageSpeed performance, SEO checks, accessibility and mobile observations.
- Findings with severity, evidence, affected URL, explanation and recommended fix.
- Add-to-proposal action.
- Do not invent one aggregate score. If an opportunity score is later used, define its formula transparently.

### AI opportunities
- Group recommendations around observed findings.
- Explain potential business relevance carefully and conditionally.
- Suggest a service, deliverables and editable effort estimate.
- Clearly mark AI interpretation vs measured evidence.

### Proposal studio
- Split editor and live preview.
- Client details, overview, objectives, selected findings, deliverables, phases/timeline, pricing and terms.
- AI rewrite/simplify/expand actions.
- All content editable.
- User controls final pricing.

### Proposal preview/history
- Export PDF.
- Save, duplicate and revisit.
- Manual status labels only (Draft/Sent/Accepted/Rejected); no implied email tracking.

### Settings
- Account details, usage, data retention and deletion controls.

## 5. Design system

### Palette
- Paper: `#F2F0EA`
- Ink: `#171A19`
- Acid lime: `#8CFF69`
- Electric blue: `#D9E7FF`
- Amber: `#E8A45D`
- Structural line: `#D8D4CA`

### Typography
- Display: Space Grotesk or Satoshi.
- Body: Inter or Geist.
- Technical: JetBrains Mono.

### Art direction
Premium technical/editorial creative-tech product. Asymmetric layouts, confident typography, restrained color, meaningful data visualization, crisp surfaces and intentional whitespace. Preserve the Stitch visual identity but reduce clutter and improve readability.

### Motion
- Homepage: clipped/staggered headline reveal; browser inspection scan with markers; subtle scroll reveals.
- Live analysis: actual-state-driven scanning and stage transitions.
- Dashboard: subtle hover, active nav, count-up only when real values load.
- Report: score/metric reveal, tabs, expand/collapse and add-to-proposal feedback.
- Proposal: live preview updates, selected-finding feedback and restrained export confirmation.
Use CSS/Motion for most; GSAP/ScrollTrigger only if needed for homepage choreography. Respect reduced-motion. Never animate fake data.

## 6. Data integrity and safety
- Distinguish raw measurements, deterministic rule findings, AI interpretations and user-entered proposal values.
- AI must only interpret supplied evidence.
- Never fabricate score, finding, URL, ROI, revenue, conversion uplift, hours saved or business outcomes.
- Treat public URL scanning as SSRF-sensitive. Block private/reserved IP ranges, localhost, metadata endpoints and unsafe redirects. Revalidate DNS/redirect destinations and cap time, size, ports and page count.
- Keep secrets server-side.
- Use clear retention rules for screenshots and crawled content.

## 7. V1 success criteria
A beta user can:
- Sign up and sign in.
- Submit a public URL.
- Receive a real, evidence-backed audit.
- Understand AI explanations and opportunities.
- Select findings.
- Create and edit a proposal.
- Export a PDF.
- Revisit saved audits and proposals.

## 8. Explicitly deferred
CRM, client portal, outreach automation, competitor analysis, collaboration, recurring scans, e-signatures, automated contracts, complex billing, revenue/ROI predictions.
