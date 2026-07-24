import type { Metadata } from "next";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { JobsBoard } from "@/components/jobs/JobsBoard";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    country?: string;
    employment_type?: string;
    work_arrangement?: string;
    experience_level?: string;
  }>;
}) {
  const filters = await searchParams;
  return (
    <div className="min-h-screen bg-surface-muted">
      <PublicHeader />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <JobsBoard searchParams={filters} />
      </div>
    </div>
  );
}
