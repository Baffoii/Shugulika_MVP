import { JobOrdersPage } from "@/components/pages/StaffLists";
export const metadata = { title: "Jobs" };
export default function Page() {
  return (
    <JobOrdersPage
      title="Jobs"
      description="Job activity across all franchises and countries. Approve submissions, then assign a recruiter to own each open role."
      canPublish
      canDeny
      canAssignRecruiter
    />
  );
}
