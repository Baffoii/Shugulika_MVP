import type { Metadata } from "next";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Badge,
  EmptyState,
} from "@/components/ui/primitives";
import { requirePortal, primaryOrgId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { OrganizationRow } from "@/lib/database.types";
import { titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Company" };

export default async function EmployerCompanyPage() {
  const session = await requirePortal("employer");
  const orgId = primaryOrgId(session.memberships);
  const supabase = createClient();
  const { data } = orgId
    ? await supabase.from("organizations").select("*").eq("id", orgId).maybeSingle()
    : { data: null };
  const org = data as OrganizationRow | null;

  if (!org) {
    return (
      <div>
        <PageHeader
          title="Company profile"
          description="Your organization details and Shugulika engagement."
        />
        <EmptyState
          title="No company linked"
          description="Ask your Shugulika franchise to attach your employer organization to this account."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={org.name}
        description="You are a Shugulika headhunting client. Recruiters run the pipeline; you review the candidate CVs they submit for your roles."
        actions={
          <Badge tone={org.verification_status === "verified" ? "success" : "warn"}>
            {titleCase(org.verification_status ?? "pending")}
          </Badge>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Field label="Company" value={org.name} />
            <Field label="Industry" value={org.industry} />
            <Field label="Company size" value={org.company_size} />
            <Field label="Country" value={org.country_code} />
            <Field label="Website" value={org.website} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your engagement</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Field label="Account type" value="Employer client (employer_user)" />
            <Field label="Service" value="Shugulika-managed headhunting" />
            <Field
              label="What you receive"
              value="Masked candidate CV packs after recruiter screening and candidate consent — not the full talent database."
            />
            <Field label="Signed-in contact" value={session.profile?.full_name || session.email} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-ink">{value || "—"}</p>
    </div>
  );
}
