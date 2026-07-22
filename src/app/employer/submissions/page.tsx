import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader, EmptyState, Alert } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { getEmployerSubmissions } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Submissions" };

type DisclosedName = {
  full_name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
};

function candidateLabel(disclosed: unknown, fallbackId: string): string {
  const d = (disclosed ?? {}) as DisclosedName;
  const name =
    d.full_name?.trim() || [d.given_name, d.family_name].filter(Boolean).join(" ").trim() || null;
  return name ?? `Candidate ${fallbackId.slice(0, 8)}`;
}

export default async function EmployerSubmissionsPage() {
  const submissions = await getEmployerSubmissions();
  const visible = submissions.filter((s) => s.status !== "consent_pending");

  return (
    <div>
      <PageHeader
        title="Candidate CVs from Shugulika"
        description="Candidates cleared to Client Submission for your roles — name, resume, and test score included."
      />
      <div className="mb-4">
        <Alert tone="info">
          Packs appear when Shugulika moves a candidate to Client Submission. Contact details stay
          inside Shugulika; withdrawal removes the pack from your view.
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
              <TH>Candidate</TH>
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
                  <span className="font-medium text-ink">
                    {candidateLabel(s.disclosed_profile, s.id)}
                  </span>
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
