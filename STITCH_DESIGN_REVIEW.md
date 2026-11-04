# ScopePilot — Stitch Design Review Notes

The supplied Stitch export is the visual source of truth for the initial design direction:
- `scopepilot_marketing_homepage`
- `scopepilot_workspace_dashboard`
- `scopepilot_website_audit_report_cal_analytics.io`
- `scopepilot_proposal_studio`
- `scopepilot_live_analysis_in_progress_cal_analytics.io`
- `technical_editorial_intelligence/DESIGN.md`

Use the exported `screen.png` files as visual references. Treat `code.html` as reference material only; do not blindly paste standalone Stitch HTML into the production app. Rebuild as reusable, responsive React components.

## Overall assessment
The design direction is distinctive and should be preserved. It combines warm paper surfaces, deep ink, acid-lime accents, technical typography and editorial composition. Some screens are too cluttered; simplify during implementation rather than restarting the visual identity.

## Screen-specific simplification
- Marketing homepage: preserve the hero and product story; remove unsupported claims and reduce decorative clutter.
- Dashboard: prioritize new audit, real statistics, recent audits and activity. Remove invented telemetry, team dispatch, revenue, win-rate and arbitrage metrics.
- Live analysis: preserve browser preview and technical scan motif; remove fake telemetry/logs and arbitrary percentages. Progress must reflect real backend states.
- Audit report: prioritize evidence-backed findings, category, severity, affected URL, explanation and fix. Avoid invented ROI and unsupported aggregate scores.
- Proposal studio: preserve split editor/preview. Keep client details, summary, selected findings, deliverables, timeline, pricing and terms. Defer e-signatures/contracts and complex workflow features.

## Motion priorities
1. Homepage headline reveal and browser inspection scan.
2. Live analysis sequence tied to real job states.
3. Subtle dashboard and report interactions.
4. Proposal selection and live preview feedback.

Avoid adding motion everywhere. The marketing page can be expressive; the app must remain fast and usable.
