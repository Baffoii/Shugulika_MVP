import {
  EmployerApplicationsQueuePage,
  type QueueSearchParams,
} from "@/components/pages/EmployerApplicationsPages";

export const metadata = { title: "Employer applications" };

export default async function Page({ searchParams }: { searchParams: Promise<QueueSearchParams> }) {
  return (
    <EmployerApplicationsQueuePage
      basePath="/franchise/employer-applications"
      description="Employer onboarding applications assigned to your franchise within your geographic region. Access is enforced by database policies, not just this list."
      searchParams={await searchParams}
    />
  );
}
