import { JobFilters } from "@/components/jobs/JobFilters";
import { JobCard } from "@/components/jobs/JobCard";
import { EmptyState, Alert } from "@/components/ui/primitives";
import { listPublicJobs } from "@/lib/data/jobs";
import { Briefcase } from "lucide-react";

export async function JobsBoard({
  searchParams,
  jobsBasePath = "/jobs",
}: {
  searchParams: {
    q?: string;
    country?: string;
    employment_type?: string;
    work_arrangement?: string;
    experience_level?: string;
  };
  jobsBasePath?: string;
}) {
  const { jobs, configured, error } = await listPublicJobs(searchParams);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Find your next role</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Browse opportunities across Shugulika&apos;s network. Only published, active roles are shown.
        </p>
      </div>

      <JobFilters basePath={jobsBasePath} />

      <div className="mt-6">
        {!configured ? (
          <Alert tone="warn" title="Database not connected yet">
            The public job board reads from Supabase. Apply the SQL in{" "}
            <code className="rounded bg-white px-1">supabase/migrations/</code> (see the README), then refresh.
            {error ? <span className="mt-1 block text-xs opacity-70">Detail: {error}</span> : null}
          </Alert>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-8 w-8" />}
            title="No roles match your filters"
            description="Try widening your search — clear a filter or change the keyword."
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-subtle">{jobs.length} role{jobs.length === 1 ? "" : "s"}</p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {jobs.map((job) => (
                <JobCard key={job.job_id} job={job} detailBasePath={jobsBasePath} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
