import { Proposals } from "@/components/proposals/proposal-list";
import styles from "../workspace.module.css";

export default function ProposalsPage() {
  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <p className="eyebrow">Proposal studio</p>
          <h1>Proposals.</h1>
          <p>Editable proposals built from opportunities you selected in an audit. Each one keeps links to the findings that support it; audit evidence itself is never changed.</p>
        </div>
      </header>
      <section className={styles.recent} aria-labelledby="proposal-list"><div className={styles.sectionHeader}><h2 id="proposal-list">Saved proposals</h2><p className="eyebrow">Latest 100</p></div><Proposals /></section>
    </>
  );
}