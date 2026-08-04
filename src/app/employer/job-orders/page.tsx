import { JobOrdersPage } from "@/components/pages/StaffLists";
import { JobOrderSubmissionForm } from "@/components/jobs/JobOrderSubmissionForm";
import { requireEmployerSubscription } from "@/lib/auth";

export const metadata = { title: "Job orders" };

export default async function Page() {
  await requireEmployerSubscription();
  return (
    <JobOrdersPage
      title="Your roles"
      description="Roles Shugulika is hiring for on your behalf. Managed (headhunting) roles deliver candidate CVs here after screening; direct roles can also receive applications."
      canWithdraw
      beforeList={<JobOrderSubmissionForm />}
    />
  );
}
