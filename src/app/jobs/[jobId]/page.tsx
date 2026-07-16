import { notFound } from "next/navigation";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { JobDetailView } from "@/components/jobs/JobDetailView";
import { getPublicJob } from "@/lib/data/jobs";

export default async function JobDetailPage({ params }: { params: { jobId: string } }) {
  const job = await getPublicJob(params.jobId);
  if (!job) notFound();

  return (
    <div className="min-h-screen bg-surface-muted">
      <PublicHeader />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <JobDetailView jobId={params.jobId} />
      </div>
    </div>
  );
}
