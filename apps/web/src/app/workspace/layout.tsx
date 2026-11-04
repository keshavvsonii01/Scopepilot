import { ErrorState } from "@scopepilot/ui/components";
import { redirect } from "next/navigation";
import { SessionProvider } from "@/components/session-provider";
import { WorkspaceShell } from "@/components/workspace-shell";
import { lookupSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lookup = await lookupSession();
  if (lookup.kind === "signed-out") redirect("/login");
  if (lookup.kind === "unavailable") {
    return <main className="shell" style={{ padding: "4rem 0" }}>
      <ErrorState title="Your workspace is temporarily unavailable">ScopePilot could not confirm your session because the API did not respond. Refresh the page in a moment.</ErrorState>
    </main>;
  }
  return <SessionProvider session={lookup.session}><WorkspaceShell>{children}</WorkspaceShell></SessionProvider>;
}