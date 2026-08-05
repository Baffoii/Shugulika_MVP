import { JobOrdersPage } from "@/components/pages/StaffLists";
import { JobOrderSubmissionForm } from "@/components/jobs/JobOrderSubmissionForm";
import { requireEmployerSubscription } from "@/lib/auth";
import Link from "next/link";

export const metadata = { title: "Job orders" };

export default async function Page() {
  await requireEmployerSubscription();
  return (
    <JobOrdersPage
      title="Your roles"
      description="Submit online roles to Shugulika for approval, or approve offline drafts Shugulika prepared for you."
      canWithdraw
      canEmployerApproveOrders
      beforeList={
        <div className="mb-6 space-y-4">
          <p className="text-sm text-ink-muted">
            Offline jobs waiting for your sign-off also appear under{" "}
            <Link href="/employer/approvals" className="font-medium text-brand-700 hover:underline">
              Approvals
            </Link>
            .
          </p>
          <JobOrderSubmissionForm />
        </div>
      }
    />
  );
}
