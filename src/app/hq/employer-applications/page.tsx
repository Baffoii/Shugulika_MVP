import {
  EmployerApplicationsQueuePage,
  type QueueSearchParams,
} from "@/components/pages/EmployerApplicationsPages";

export const metadata = { title: "Employer applications" };

export default async function Page({ searchParams }: { searchParams: Promise<QueueSearchParams> }) {
  return (
    <EmployerApplicationsQueuePage
      basePath="/hq/employer-applications"
      description="Every employer onboarding application across all countries and regions. HQ can review, decide, and assign the responsible office."
      searchParams={await searchParams}
    />
  );
}
