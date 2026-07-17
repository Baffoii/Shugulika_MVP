import { OrgsPage } from "@/components/pages/StaffLists";
export const metadata = { title: "Franchises" };
export default function Page() {
  return (
    <OrgsPage
      type="franchise"
      title="Franchises"
      description="All franchises across the network."
    />
  );
}
