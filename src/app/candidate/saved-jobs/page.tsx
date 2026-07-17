import type { Metadata } from "next";
import { PageHeader, EmptyState, ButtonLink } from "@/components/ui/primitives";
import { JobCard } from "@/components/jobs/JobCard";
import { getMyCandidate, getMySavedJobs } from "@/lib/data/candidate";

export const metadata: Metadata = { title: "Saved jobs" };

export default async function SavedJobsPage() {
  const candidate = await getMyCandidate();
  if (!candidate) return null;
  const jobs = await getMySavedJobs(candidate.id);
  return (
    <div>
      <PageHeader title="Saved jobs" description="Roles you've bookmarked to apply to later." />
      {jobs.length === 0 ? (
        <EmptyState
          title="No saved jobs"
          description="Save roles from the job board to find them here."
          action={
            <ButtonLink href="/candidate/jobs" size="sm">
              Browse jobs
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => (
            <JobCard key={j.job_id} job={j} detailBasePath="/candidate/jobs" />
          ))}
        </div>
      )}
    </div>
  );
}
