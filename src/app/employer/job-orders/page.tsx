import { JobOrdersPage } from "@/components/pages/StaffLists";
export const metadata = { title: "Job orders" };
export default function Page() {
  return (
    <JobOrdersPage
      title="Job orders"
      description="Roles you have submitted. Direct-employer roles receive applications; managed roles receive recruiter submissions."
    />
  );
}
