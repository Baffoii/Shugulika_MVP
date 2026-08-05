import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient } from "@/lib/supabase/server";
import {
  getMyAssessmentAssignments,
  getMyCandidate,
  getMyResultSnapshots,
} from "@/lib/data/candidate";
import type { JobOrderRow } from "@/lib/database.types";
import type { CandidateAssessmentListItem } from "@/lib/candidate/types";
import { formatDate, titleCase } from "@/lib/format";
import { CandidateAssessmentActions } from "@/components/assessments/CandidateAssessmentActions";

export const metadata: Metadata = { title: "Assessments" };

type JobMeta = Pick<
  JobOrderRow,
  "id" | "title" | "employer_org_id" | "is_confidential" | "assessment_file_name"
>;

export default async function CandidateAssessmentsPage() {
  const candidate = await getMyCandidate();
  if (!candidate) return null;
  const supabase = createClient();
  const assignments = await getMyAssessmentAssignments(candidate.id);
  const snapshots = await getMyResultSnapshots(
    candidate.id,
    assignments.map((assignment) => assignment.id),
  );
  const resultIds = new Set(snapshots.map((snapshot) => snapshot.assignment_id));
  const jobIds = [...new Set(assignments.map((item) => item.job_order_id))];
  const { data: jobsData } = jobIds.length
    ? await supabase
        .from("job_orders")
        .select("id,title,employer_org_id,is_confidential,assessment_file_name")
        .in("id", jobIds)
    : { data: [] };
  const jobs = new Map(((jobsData as JobMeta[] | null) ?? []).map((job) => [job.id, job]));
  const employerIds = [
    ...new Set(
      [...jobs.values()].filter((job) => !job.is_confidential).map((job) => job.employer_org_id),
    ),
  ];
  const { data: orgsData } = employerIds.length
    ? await supabase.from("organizations").select("id,name").in("id", employerIds)
    : { data: [] };
  const employers = new Map(
    ((orgsData as { id: string; name: string }[] | null) ?? []).map((org) => [org.id, org.name]),
  );
  const active = assignments.filter(
    (item) => !["submitted", "graded", "cancelled", "expired"].includes(item.status),
  );
  const completed = assignments.filter((item) =>
    ["submitted", "graded", "cancelled", "expired"].includes(item.status),
  );

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Aptitude assessments for applications in Skills assessment."
        actions={
          <ButtonLink href="/candidate/help" size="sm" variant="outline">
            Preparation & help
          </ButtonLink>
        }
      />
      <AssessmentSection
        title="Assigned & in progress"
        assignments={active}
        jobs={jobs}
        employers={employers}
        resultIds={resultIds}
      />
      <div className="mt-8">
        <AssessmentSection
          title="Completed"
          assignments={completed}
          jobs={jobs}
          employers={employers}
          resultIds={resultIds}
        />
      </div>
    </div>
  );
}

function AssessmentSection({
  title,
  assignments,
  jobs,
  employers,
  resultIds,
}: {
  title: string;
  assignments: CandidateAssessmentListItem[];
  jobs: Map<string, JobMeta>;
  employers: Map<string, string>;
  resultIds: Set<string>;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <Badge tone="neutral">{assignments.length}</Badge>
      </div>
      {assignments.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-7 w-7" aria-hidden />}
          title="No assessments"
          description="When your application moves to Skills assessment, your test appears here so you can start it."
        />
      ) : (
        <div className="space-y-3">
          {assignments.map((assignment) => {
            const job = jobs.get(assignment.job_order_id);
            const employerLabel = !job
              ? null
              : job.is_confidential
                ? "Confidential employer"
                : (employers.get(job.employer_org_id) ?? "Employer");
            const includesEmployer = assignment.assessment_mode !== "shugulika";
            return (
              <Card key={assignment.id}>
                <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-ink">
                        {job?.title ?? "Aptitude assessment"}
                      </h3>
                      <StatusBadge status={assignment.status} />
                    </div>
                    {employerLabel ? (
                      <p className="mt-1 text-sm text-ink-muted">{employerLabel}</p>
                    ) : null}
                    <p className="mt-1 text-sm text-ink-muted">
                      {assignment.assessment_mode === "both"
                        ? "Shugulika and employer tests"
                        : assignment.assessment_mode === "employer"
                          ? "Employer-provided test"
                          : "Shugulika scenario-based test"}
                      {` · ${titleCase(assignment.assessment_seniority)}`}
                    </p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      Assigned {formatDate(assignment.assigned_at)}
                      {assignment.due_at ? ` · Due ${formatDate(assignment.due_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {resultIds.has(assignment.id) ? (
                      <ButtonLink
                        href={`/candidate/assessments/${assignment.id}/result`}
                        size="sm"
                        variant="secondary"
                      >
                        View permitted result
                      </ButtonLink>
                    ) : null}
                    <CandidateAssessmentActions
                      assignmentId={assignment.id}
                      jobOrderId={assignment.job_order_id}
                      mode={assignment.assessment_mode}
                      status={assignment.status}
                      fileName={includesEmployer ? (job?.assessment_file_name ?? null) : null}
                    />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
