import { safeNextPath } from "@scopepilot/contracts/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthLayout } from "@/components/auth/auth-layout";
import { lookupSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in — ScopePilot" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const next = safeNextPath((await searchParams).next);
  const lookup = await lookupSession();
  if (lookup.kind === "signed-in") redirect(next);
  return <AuthLayout eyebrow="Sign in" title="Welcome back." lede="Sign in to reach your audits and proposals." notice={lookup.kind === "unavailable" ? "ScopePilot is having trouble reaching its API. Sign-in may fail until it recovers." : undefined}>
    <AuthForm mode="login" next={next} />
  </AuthLayout>;
}