import { OrgsPage } from "@/components/pages/StaffLists";
import { ButtonLink } from "@/components/ui/primitives";

export const metadata = { title: "Employers" };

export default function Page() {
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <ButtonLink href="/franchise/employers/health" variant="secondary" size="sm">
          Employer health
        </ButtonLink>
      </div>
      <OrgsPage
        type="employer"
        title="Employers"
        description="Client organizations in your franchise. Records are private to your franchise and HQ oversight. Open Employer health for open jobs, overdue approvals, stalled vacancies, and repeat placements."
      />
    </div>
  );
}
