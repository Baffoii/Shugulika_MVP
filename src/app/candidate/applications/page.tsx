import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Card, EmptyState, Badge, ButtonLink } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import {
  getMyCandidate,
  getMyApplications,
  getMyVisibleEvents,
  applicationRoleLabel,
} from "@/lib/data/candidate";
import { CANDIDATE_FACING_STATUS } from "@/lib/constants";
import { statusTone } from "@/components/StatusBadge";
import { formatDate, titleCase } from "@/lib/format";
import { WithdrawButton, GrantEmployerConsentButton } from "./ApplicationActions";

export const metadata: Metadata = { title: "Applications" };

export default async function CandidateApplicationsPage() {
  const candidate = await getMyCandidate();
  if (!candidate) return null;
  const [apps, events] = await Promise.all([
    getMyApplications(candidate.id),
    getMyVisibleEvents(candidate.id),
  ]);
  const latestEventByApplication = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    if (event.application_id && !latestEventByApplication.has(event.application_id)) {
      latestEventByApplication.set(event.application_id, event);
    }
  }

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
              <TH>Last visible update</TH>
              <TH>Route</TH>
              <TH className="text-right">Action</TH>
            </TR>
          </THead>
          <tbody>
            {apps.map((a) => {
              const latestEvent = latestEventByApplication.get(a.id);
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
                    {a.current_stage === "testing" && !a.withdrawn_at ? (
                      <Link
                        href="/candidate/assessments"
                        className="inline-flex rounded-badge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        <Badge tone={statusTone(a.current_stage)} className="hover:opacity-80">
                          {label}
                        </Badge>
                      </Link>
                    ) : (
                      <Badge tone={a.withdrawn_at ? "neutral" : statusTone(a.current_stage)}>
                        {label}
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-ink-muted">
                    {latestEvent ? (
                      <span>
                        {latestEvent.label}
                        <span className="block text-xs text-ink-subtle">
                          {formatDate(latestEvent.occurred_at)}
                        </span>
                      </span>
                    ) : (
                      "Application received"
                    )}
                  </TD>
                  <TD className="text-ink-muted">
                    {a.recruitment_path === "A" ? "Direct employer" : "Shugulika-managed"}
                  </TD>
                  <TD className="text-right">
                    <span className="inline-flex flex-wrap items-center justify-end gap-2">
                      <ButtonLink
                        href={`/candidate/applications/${a.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Progress & sharing
                      </ButtonLink>
                      {a.withdrawn_at || a.current_stage === "rejected" ? (
                        <ButtonLink
                          href={`/candidate/apply/${a.job_order_id}?reapply=1`}
                          variant="outline"
                          size="sm"
                        >
                          Apply again
                        </ButtonLink>
                      ) : (
                        <>
                          {a.consent_status === "pending" ? (
                            <GrantEmployerConsentButton applicationId={a.id} />
                          ) : null}
                          <WithdrawButton applicationId={a.id} />
                        </>
                      )}
                    </span>
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
