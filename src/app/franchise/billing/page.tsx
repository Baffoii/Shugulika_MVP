import { InvoicesPage } from "@/components/pages/StaffLists";
export const metadata = { title: "Billing" };
export default function Page() {
  return (
    <InvoicesPage
      title="Billing"
      description="Invoices and payment status for your franchise. HQ sees country totals; you see your own."
    />
  );
}
