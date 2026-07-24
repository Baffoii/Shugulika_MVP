import { EmployerApplicationReviewPage } from "@/components/pages/EmployerApplicationsPages";

export const metadata = { title: "Review employer application" };

export default function Page({ params }: { params: { applicationId: string } }) {
  return (
    <EmployerApplicationReviewPage
      applicationId={params.applicationId}
      basePath="/franchise/employer-applications"
      canReassign={false}
    />
  );
}
