"use client";

import { FormEvent, MouseEvent, useState } from "react";
import { NavAuthLink } from "@/components/nav-auth-link";
import { StartAuditDialog } from "@/components/start-audit-dialog";
import styles from "./page.module.css";

const phases = [
  ["01", "Inspect", "Capture a controlled view of the public site."],
  [
    "02",
    "Verify",
    "Collect deterministic performance, structure, and accessibility evidence.",
  ],
  ["03", "Interpret", "Translate verified findings into clear opportunities."],
  ["04", "Scope", "Select findings and shape an editable proposal."],
];

const disciplines = [
  [
    "PERFORMANCE",
    "Measured delivery and loading behavior",
    "LCP, render-blocking resources, layout stability",
  ],
  [
    "ACCESSIBILITY",
    "Rule-based accessibility checks",
    "Selected axe-core checks and visible viewport observations",
  ],
  [
    "STRUCTURE",
    "Technical page structure",
    "Metadata, headings, links, images, canonical and robots signals",
  ],
];

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [auditDialogOpen, setAuditDialogOpen] = useState(false);

  // Secondary CTAs open the shared audit dialog; their #start href remains the no-JavaScript fallback.
  function openAuditDialog(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    setAuditDialogOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = url.trim();
    if (!candidate)
      return setMessage("Enter a public website URL to continue.");
    try {
      const parsed = new URL(
        candidate.includes("://") ? candidate : `https://${candidate}`,
      );
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      setMessage(
        "Create a free account or sign in to run this audit from your workspace.",
      );
    } catch {
      setMessage("Use a complete public HTTP or HTTPS URL.");
    }
  }

  return (
    <main>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={`shell ${styles.headerInner}`}>
          <a className={styles.brand} href="#top" aria-label="ScopePilot home">
            <span />
            ScopePilot
          </a>
          <nav className={styles.nav} aria-label="Primary navigation">
            <a href="#workflow">Workflow</a>
            <a href="#evidence">Evidence</a>
            <a href="#proposal">Proposal</a>
            <NavAuthLink />
          </nav>
          <a
            className="button button-primary"
            href="#start"
            aria-haspopup="dialog"
            onClick={openAuditDialog}
          >
            Start an audit <span aria-hidden>→</span>
          </a>
        </div>
      </header>

      <section
        id="top"
        className={`shell ${styles.hero}`}
        aria-labelledby="hero-heading"
      >
        <div className={styles.heroCopy}>
          <p className={`eyebrow ${styles.kicker}`}>
            <span /> Website intelligence for independent teams
          </p>
          <h1 id="hero-heading" className={`display ${styles.heroTitle}`}>
            <span>Find what</span>
            <span>others miss.</span>
          </h1>
          <p className={styles.intro}>
            Turn a prospects public website into verified technical evidence,
            understandable improvement opportunities, and an editable client
            proposal.
          </p>
          <form
            id="start"
            onSubmit={handleSubmit}
            className={styles.urlForm}
            noValidate
          >
            <label htmlFor="site-url" className="eyebrow">
              Prospect website
            </label>
            <div className={styles.inputRow}>
              <span aria-hidden>⌘</span>
              <input
                id="site-url"
                name="site-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://prospect.com"
                inputMode="url"
              />
              <button className="button button-lime" type="submit">
                Inspect site <span aria-hidden>→</span>
              </button>
            </div>
            <p className={styles.formNote} aria-live="polite">
              {message ? (
                <>
                  {message}{" "}
                  <a href="/register">
                    <u>Create an account</u>
                  </a>{" "}
                  ·{" "}
                  <a href="/login">
                    <u>Sign in</u>
                  </a>
                </>
              ) : (
                "Public HTTP/HTTPS URLs only. Scope and limits are shown before a scan begins."
              )}
            </p>
          </form>
        </div>
        <InspectionPreview />
      </section>

      <section
        id="workflow"
        className={styles.workflow}
        aria-labelledby="workflow-heading"
      >
        <div className="shell">
          <div className={styles.sectionHeading}>
            <p className="registration">ScopePilot workflow</p>
            <h2 id="workflow-heading" className="display">
              From site signal to a scope you can stand behind.
            </h2>
          </div>
          <div className={styles.phaseGrid}>
            {phases.map(([number, title, copy]) => (
              <article className={styles.phase} key={number}>
                <span className="eyebrow">{`${number} //`}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="evidence"
        className={`shell ${styles.evidence}`}
        aria-labelledby="evidence-heading"
      >
        <div className={styles.evidenceCopy}>
          <p className="registration">Evidence, before interpretation</p>
          <h2 id="evidence-heading" className="display">
            Technical detail your clients can follow.
          </h2>
          <p>
            ScopePilot separates measured values, rule-based observations, AI
            interpretation, and the decisions you make. That distinction stays
            visible from audit to proposal.
          </p>
          <a className="button button-secondary" href="#proposal">
            See proposal flow <span aria-hidden>→</span>
          </a>
        </div>
        <div className={styles.disciplineList}>
          {disciplines.map(([label, title, copy], index) => (
            <article className={styles.discipline} key={label}>
              <div>
                <span className="eyebrow">{`0${index + 1} // ${label}`}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
              <span className={styles.crosshair} aria-hidden>
                +
              </span>
            </article>
          ))}
        </div>
      </section>

      <section
        id="proposal"
        className={styles.proposal}
        aria-labelledby="proposal-heading"
      >
        <div className={`shell ${styles.proposalGrid}`}>
          <div>
            <p className="registration">Proposal studio</p>
            <h2
              id="proposal-heading"
              className={`display ${styles.proposalTitle}`}
            >
              Build the proposal. Keep the judgment.
            </h2>
            <p>
              Choose the evidence that matters, then edit every finding,
              deliverable, timeline, price, and term before you share it.
            </p>
            <a
              className="button button-primary"
              href="#start"
              aria-haspopup="dialog"
              onClick={openAuditDialog}
            >
              Start with a website <span aria-hidden>→</span>
            </a>
          </div>
          <ProposalSheet />
        </div>
      </section>

      <footer className={styles.footer}>
        <div className="shell">
          <a className={styles.brand} href="#top">
            <span />
            ScopePilot
          </a>
          <p className="eyebrow">Evidence-backed scopes for web work.</p>
          <a
            className="button button-primary"
            href="#start"
            aria-haspopup="dialog"
            onClick={openAuditDialog}
          >
            Start an audit <span aria-hidden>→</span>
          </a>
          <p className={styles.footerMeta}>
            © {new Date().getFullYear()} ScopePilot
          </p>
        </div>
      </footer>
      <StartAuditDialog
        open={auditDialogOpen}
        onClose={() => setAuditDialogOpen(false)}
      />
    </main>
  );
}

function InspectionPreview() {
  return (
    <div
      className={styles.previewWrap}
      aria-label="Illustrative website inspection preview"
    >
      <div className={styles.previewLabel}>
        <span className="eyebrow">Inspection preview</span>
        <span className={styles.liveDot}>Ready</span>
      </div>
      <div className={styles.browser}>
        <div className={styles.browserChrome}>
          <i />
          <i />
          <i />
          <span>https://prospect.com</span>
        </div>
        <div className={styles.viewport}>
          <div className={styles.previewNav}>
            <b>ACME</b>
            <span>Work&nbsp;&nbsp; About&nbsp;&nbsp; Contact</span>
          </div>
          <div className={styles.previewHero}>
            <small>CREATIVE SYSTEMS</small>
            <strong>
              Work that
              <br />
              holds attention.
            </strong>
            <p>A focused digital practice for brands in motion.</p>
            <button>Explore work</button>
          </div>
          <div className={styles.findingOne}>
            <b>!</b> IMAGE ASSET // REVIEW
          </div>
          <div className={styles.findingTwo}>TEXT CONTRAST // CHECK</div>
          <div className={styles.scanLine} />
        </div>
        <div className={styles.browserFooter}>
          <span>VIEWPORT 1440 × 900</span>
          <span>ELEMENT MARKERS 02</span>
        </div>
      </div>
    </div>
  );
}

function ProposalSheet() {
  return (
    <article className={styles.sheet}>
      <div className={styles.sheetBar}>
        <span className="eyebrow">ScopePilot / proposal draft</span>
        <span>+</span>
      </div>
      <div className={styles.sheetBody}>
        <p className="eyebrow">Engineering remediation proposal</p>
        <h3>
          Website foundation
          <br />
          and performance sprint
        </h3>
        <p className={styles.sheetLead}>
          A focused implementation plan based on selected, evidence-backed
          findings.
        </p>
        <div className={styles.sheetRule} />
        <div className={styles.sheetRows}>
          <div>
            <span>{"01 // Asset delivery"}</span>
            <b>Selected</b>
          </div>
          <div>
            <span>{"02 // Accessibility fixes"}</span>
            <b>Selected</b>
          </div>
          <div>
            <span>{"03 // Technical structure"}</span>
            <b>Optional</b>
          </div>
        </div>
        <div className={styles.sheetTotal}>
          <span>Total project investment</span>
          <strong>Editable</strong>
        </div>
      </div>
    </article>
  );
}
