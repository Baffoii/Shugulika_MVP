import { notFound } from "next/navigation";
import { JobDetailView } from "@/components/jobs/JobDetailView";
import { getPublicJob } from "@/lib/data/jobs";

export default async function CandidateJobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const job = await getPublicJob(jobId);
  if (!job) notFound();

  return <JobDetailView jobId={jobId} jobsBasePath="/candidate/jobs" />;
}
