import type { Metadata } from "next";
import { JobsBoard } from "@/components/jobs/JobsBoard";

export const metadata: Metadata = { title: "Browse jobs" };

export default async function CandidateJobsPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    country?: string;
    employment_type?: string;
    work_arrangement?: string;
    experience_level?: string;
  };
}) {
  return <JobsBoard searchParams={searchParams} jobsBasePath="/candidate/jobs" />;
}
