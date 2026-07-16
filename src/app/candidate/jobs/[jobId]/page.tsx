import { notFound } from "next/navigation";
import { JobDetailView } from "@/components/jobs/JobDetailView";
import { getPublicJob } from "@/lib/data/jobs";

export default async function CandidateJobDetailPage({ params }: { params: { jobId: string } }) {
  const job = await getPublicJob(params.jobId);
  if (!job) notFound();

  return <JobDetailView jobId={params.jobId} jobsBasePath="/candidate/jobs" />;
}
