"use client";

import Link from "next/link";
import { FilePlus2, FileText, LayoutDashboard, LogOut, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { authApi } from "@/lib/api-client";
import { useOptionalSession } from "./session-provider";
import styles from "./workspace-shell.module.css";

const navigation = [
  { href: "/workspace", label: "Dashboard", icon: LayoutDashboard },
  { href: "/workspace/audits/new", label: "New audit", icon: FilePlus2 },
  { href: "/workspace/proposals", label: "Proposals", icon: FileText },
];

export function WorkspaceShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const session = useOptionalSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await authApi.logout();
      window.location.replace("/login");
    } catch {
      setSigningOut(false);
      setSignOutError("Sign-out could not reach the server. Try again.");
    }
  }

  return <div className={styles.appShell}>
    <button className={styles.menuButton} type="button" aria-label="Open workspace navigation" aria-expanded={isOpen} onClick={() => setIsOpen(true)}>Menu</button>
    <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ""}`} aria-label="Workspace navigation">
      <div className={styles.sidebarTop}>
        <Link className={styles.brand} href="/"><span />ScopePilot</Link>
        <button className={styles.closeButton} type="button" aria-label="Close workspace navigation" onClick={() => setIsOpen(false)}><X size={18} /></button>
      </div>
      <div className={styles.workspaceMarker}><span className="eyebrow">Workspace</span><p><i />{session?.workspace.name ?? "Personal workspace"}</p></div>
      <nav className={styles.navigation}>
        <p className="eyebrow">Workspace navigation</p>
        {navigation.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={pathname === href || (href === "/workspace/proposals" && pathname.startsWith(`${href}/`)) ? styles.activeNav : styles.navLink} onClick={() => setIsOpen(false)}><Icon size={16} /><span>{label}</span></Link>)}
      </nav>
      <div className={styles.sidebarFoot}>
        <span className="eyebrow">Signed in</span>
        <p><i /> {session?.user.name ?? "Account"}</p>
        {session && <span className={styles.accountEmail}>{session.user.email}</span>}
        <button className={styles.signOut} type="button" onClick={signOut} disabled={signingOut}><LogOut size={14} />{signingOut ? "Signing out…" : "Log out"}</button>
        {signOutError && <span role="alert">{signOutError}</span>}
      </div>
    </aside>
    {isOpen && <button className={styles.backdrop} type="button" aria-label="Close workspace navigation" onClick={() => setIsOpen(false)} />}
    <div className={styles.mainColumn}>
      <header className={styles.topbar}><div><span className="eyebrow">ScopePilot / workspace</span><p>Evidence-led website intelligence</p></div><div className={styles.topbarState}><span /><span className="eyebrow">Signed in{session && <span className={styles.topbarEmail}> · {session.user.email}</span>}</span></div></header>
      <main className={styles.main}>{children}</main>
    </div>
  </div>;
}
