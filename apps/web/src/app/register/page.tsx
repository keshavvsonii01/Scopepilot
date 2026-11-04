import { safeNextPath } from "@scopepilot/contracts/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthLayout } from "@/components/auth/auth-layout";
import { lookupSession } from "@/lib/session";

export const metadata: Metadata = { title: "Create account — ScopePilot" };
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const next = safeNextPath((await searchParams).next);
  const lookup = await lookupSession();
  if (lookup.kind === "signed-in") redirect(next);
  return <AuthLayout eyebrow="Create account" title="Start your workspace." lede="Your account gets a private workspace. Audits and proposals you create are visible only to you." notice={lookup.kind === "unavailable" ? "ScopePilot is having trouble reaching its API. Registration may fail until it recovers." : undefined}>
    <AuthForm mode="register" next={next} />
  </AuthLayout>;
}