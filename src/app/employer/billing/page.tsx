import { InvoicesPage } from "@/components/pages/StaffLists";
export const metadata = { title: "Billing" };
export default function Page() {
  return (
    <InvoicesPage
      title="Billing"
      description="Your package, entitlements, and invoices. Payments are recorded manually in this MVP."
    />
  );
}
