import { JobOrdersPage } from "@/components/pages/StaffLists";
export const metadata = { title: "Jobs & orders" };
export default function Page() {
  return (
    <JobOrdersPage
      title="Jobs & orders"
      description="Job orders you are assigned to or authorized to manage."
    />
  );
}
