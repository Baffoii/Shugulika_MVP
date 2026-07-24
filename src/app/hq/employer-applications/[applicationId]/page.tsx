import { EmployerApplicationReviewPage } from "@/components/pages/EmployerApplicationsPages";

export const metadata = { title: "Review employer application" };

export default async function Page({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  return (
    <EmployerApplicationReviewPage
      applicationId={applicationId}
      basePath="/hq/employer-applications"
      canReassign
    />
  );
}
