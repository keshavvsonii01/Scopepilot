import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditReport } from "@/components/report/audit-report";

export default async function AuditReportPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  if (!/^[a-f0-9]{24}$/.test(auditId)) notFound();
  return (
    <>
      <p><Link href="/workspace" className="eyebrow">← All audits</Link></p>
      <AuditReport auditId={auditId} />
    </>
  );
}
