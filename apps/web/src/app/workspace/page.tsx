import { RecentAudits } from "@/components/recent-audits";
import Link from "next/link";
import styles from "./workspace.module.css";

export default function WorkspacePage() {
  return <><header className={styles.pageHeader}><div><p className="eyebrow">Workspace dashboard</p><h1>Your audit register.</h1><p>Evidence-backed website audits for this workspace. Open an audit to review measured findings and, where configured, an AI interpretation of them.</p></div><Link className="sp-button sp-button--lime" href="/workspace/audits/new">New audit <span aria-hidden>→</span></Link></header><section className={styles.recent} aria-labelledby="recent-audits"><div className={styles.sectionHeader}><h2 id="recent-audits">Recent audits</h2><p className="eyebrow">Latest 20</p></div><RecentAudits /></section><section className={styles.scopeGrid} aria-label="What an audit covers"><article><p className="eyebrow">01 // Site boundary</p><h2>Up to four pages</h2><p>Homepage plus up to three relevant internal pages in standard mode.</p></article><article><p className="eyebrow">02 // Evidence</p><h2>Deterministic first</h2><p>Measured and rule-based observations stay distinct from AI interpretation.</p></article><article><p className="eyebrow">03 // Your control</p><h2>Review before scope</h2><p>You choose the findings that become client-facing proposal material.</p></article></section></>;
}
