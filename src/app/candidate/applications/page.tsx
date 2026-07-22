import type { Metadata } from "next";
import { PageHeader, Card, EmptyState, Badge, ButtonLink } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { getMyCandidate, getMyApplications, applicationRoleLabel } from "@/lib/data/candidate";
import { CANDIDATE_FACING_STATUS } from "@/lib/constants";
import { statusTone } from "@/components/StatusBadge";
import { formatDate, titleCase } from "@/lib/format";
import { WithdrawButton } from "./ApplicationActions";

export const metadata: Metadata = { title: "Applications" };

export default async function CandidateApplicationsPage() {
  const candidate = await getMyCandidate();
  if (!candidate) return null;
  const apps = await getMyApplications(candidate.id);

  return (
    <div>
      <PageHeader
        title="My applications"
        description="Every role you've applied to, with a clear status. Your full history stays permanently visible to you."
      />
      {apps.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Browse open roles and apply."
          action={
            <ButtonLink href="/candidate/jobs" size="sm">
              Browse jobs
            </ButtonLink>
          }
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Role</TH>
              <TH>Applied</TH>
              <TH>Status</TH>
              <TH>Route</TH>
              <TH className="text-right">Action</TH>
            </TR>
          </THead>
          <tbody>
            {apps.map((a) => {
              const label = a.withdrawn_at
                ? "Withdrawn"
                : (CANDIDATE_FACING_STATUS[a.current_stage] ?? titleCase(a.current_stage));
              return (
                <TR key={a.id}>
                  <TD>
                    <span className="font-medium text-ink">{applicationRoleLabel(a)}</span>
                  </TD>
                  <TD className="text-ink-muted">{formatDate(a.created_at)}</TD>
                  <TD>
                    <Badge tone={a.withdrawn_at ? "neutral" : statusTone(a.current_stage)}>
                      {label}
                    </Badge>
                  </TD>
                  <TD className="text-ink-muted">
                    {a.recruitment_path === "A" ? "Direct employer" : "Shugulika-managed"}
                  </TD>
                  <TD className="text-right">
                    {a.withdrawn_at ? (
                      <ButtonLink
                        href={`/candidate/apply/${a.job_order_id}?reapply=1`}
                        variant="outline"
                        size="sm"
                      >
                        Apply again
                      </ButtonLink>
                    ) : (
                      <WithdrawButton applicationId={a.id} />
                    )}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <Card className="mt-4 p-4 text-xs text-ink-subtle">
        Statuses shown here are candidate-friendly. Recruiters see a more detailed internal
        pipeline.
      </Card>
    </div>
  );
}
