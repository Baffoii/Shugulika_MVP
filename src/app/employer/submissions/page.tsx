import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader, EmptyState, Alert } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { getEmployerSubmissions } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Submissions" };

export default async function EmployerSubmissionsPage() {
  const submissions = await getEmployerSubmissions();
  // Employers see only submissions actually shared with them (consent-gated); pending ones aren't visible via RLS.
  const visible = submissions.filter((s) => s.status !== "consent_pending");

  return (
    <div>
      <PageHeader
        title="Candidate CVs from Shugulika"
        description="The end of the headhunting pipeline: masked, view-only CV packs your recruiters have cleared for you. You never see the wider talent database."
      />
      <div className="mb-4">
        <Alert tone="info">
          Profiles stay masked until the candidate consents to share full identity and contact
          details with your organization. Recruiter-only notes stay inside Shugulika.
        </Alert>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          title="No CVs yet"
          description="When Shugulika submits a candidate for one of your roles, their CV pack appears here."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Sent to you</TH>
              <TH className="text-right">Review</TH>
            </TR>
          </THead>
          <tbody>
            {visible.map((s) => (
              <TR key={s.id}>
                <TD>
                  <span className="font-medium text-ink">Candidate {s.id.slice(0, 8)}</span>
                </TD>
                <TD className="text-ink-muted">{s.job_orders?.title ?? "Role"}</TD>
                <TD>
                  <StatusBadge status={s.status} />
                </TD>
                <TD className="text-ink-muted">{formatDate(s.submitted_at ?? s.created_at)}</TD>
                <TD className="text-right">
                  <Link
                    href={`/employer/submissions/${s.id}`}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    Open
                  </Link>
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
