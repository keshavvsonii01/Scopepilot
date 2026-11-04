import Link from "next/link";
import { notFound } from "next/navigation";
import { ProposalStudio } from "@/components/proposals/proposal-studio";

export default async function ProposalPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await params;
  if (!/^[a-f0-9]{24}$/.test(proposalId)) notFound();
  return (
    <>
      <p><Link href="/workspace/proposals" className="eyebrow">← All proposals</Link></p>
      <ProposalStudio proposalId={proposalId} />
    </>
  );
}