import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader, EmptyState, Alert, Badge } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { requireEmployerSubscription } from "@/lib/auth";
import { getEmployerSubmissions } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";
import {
  getEmployerPlanSnapshot,
  isCandidateUnlocked,
  teaserLabel,
} from "@/lib/employer-entitlements";

export const metadata: Metadata = { title: "Submissions" };

export default async function EmployerSubmissionsPage() {
  const { employerOrg } = await requireEmployerSubscription();
  const [submissions, plan] = await Promise.all([
    getEmployerSubmissions(),
    getEmployerPlanSnapshot(employerOrg.id),
  ]);
  const visible = submissions.filter((s) => s.status !== "consent_pending");
  const unlockFlags = await Promise.all(
    visible.map((s) => isCandidateUnlocked(employerOrg.id, s.candidate_id)),
  );

  return (
    <div>
      <PageHeader
        title="Candidate CVs from Shugulika"
        description="Managed (Path B) packs from Shugulika. Masked teasers are free; spend a CV unlock to open a full pack. For Direct (Path A) pool search, use Find candidates."
        actions={
          <Badge tone="brand">
            {plan.cvUnlockBalance} unlock{plan.cvUnlockBalance === 1 ? "" : "s"} left
          </Badge>
        }
      />
      <div className="mb-4">
        <Alert tone="info">
          Packs appear when Shugulika moves a candidate to Client Submission. Contact details stay
          inside Shugulika. Searching the pool yourself is only for{" "}
          <Link href="/employer/find-candidates" className="font-medium underline">
            Direct roles
          </Link>
          . Buy more unlocks from{" "}
          <Link href="/employer/billing" className="font-medium underline">
            Billing
          </Link>
          .
        </Alert>
      </div>
      {visible.length === 0 ? (
        <EmptyState
          title="No CVs yet"
          description="When Shugulika submits a candidate for one of your roles, their teaser appears here."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Candidate</TH>
              <TH>Role</TH>
              <TH>Access</TH>
              <TH>Status</TH>
              <TH>Sent to you</TH>
              <TH className="text-right">Review</TH>
            </TR>
          </THead>
          <tbody>
            {visible.map((s, i) => {
              const unlocked = unlockFlags[i] ?? false;
              return (
                <TR key={s.id}>
                  <TD>
                    <span className="font-medium text-ink">
                      {teaserLabel(
                        unlocked
                          ? (s.full_disclosed_profile ?? s.disclosed_profile)
                          : s.disclosed_profile,
                        unlocked,
                        s.id,
                      )}
                    </span>
                  </TD>
                  <TD className="text-ink-muted">{s.job_orders?.title ?? "Role"}</TD>
                  <TD>
                    {unlocked ? (
                      <Badge tone="success">Unlocked</Badge>
                    ) : (
                      <Badge tone="warn">Teaser</Badge>
                    )}
                  </TD>
                  <TD>
                    <StatusBadge status={s.status} />
                  </TD>
                  <TD className="text-ink-muted">{formatDate(s.submitted_at ?? s.created_at)}</TD>
                  <TD className="text-right">
                    <Link
                      href={`/employer/submissions/${s.id}`}
                      className="text-sm font-medium text-brand-700 hover:underline"
                    >
                      {unlocked ? "Open" : "Preview"}
                    </Link>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
