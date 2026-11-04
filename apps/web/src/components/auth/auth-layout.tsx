import Link from "next/link";
import styles from "./auth.module.css";

const steps = [
  ["01", "Inspect a public website with a controlled crawl."],
  ["02", "Review measured SEO, performance and accessibility evidence."],
  ["03", "Select supported opportunities and shape an editable proposal."],
];

/** Editorial two-column frame shared by the sign-in and registration pages. */
export function AuthLayout({ eyebrow, title, lede, notice, children }: Readonly<{ eyebrow: string; title: string; lede: string; notice?: string; children: React.ReactNode }>) {
  return <div className={styles.page}>
    <aside className={styles.aside} aria-hidden>
      <span className="eyebrow">ScopePilot / private workspace</span>
      <h2 className="display">Evidence first. Scope second.</h2>
      <ol>{steps.map(([number, text]) => <li key={number}><span>{number}</span>{text}</li>)}</ol>
    </aside>
    <main className={styles.panel} id="main-content">
      <Link className={styles.brand} href="/"><span />ScopePilot</Link>
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="display">{title}</h1>
      <p className={styles.lede}>{lede}</p>
      {notice && <p className={styles.status} role="status">{notice}</p>}
      {children}
    </main>
  </div>;
}
