import type { Metadata } from "next";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Badge,
  Alert,
} from "@/components/ui/primitives";
import { requireApprovedEmployer } from "@/lib/auth";
import { getOrganizationName } from "@/lib/data/employer-applications";
import { titleCase } from "@/lib/format";
import { CompanyDetailsForm } from "./CompanyDetailsForm";

export const metadata: Metadata = { title: "Company" };

export default async function EmployerCompanyPage() {
  const { ctx: session, employerOrg: org } = await requireApprovedEmployer();
  const isAdmin = session.memberships.some(
    (m) =>
      m.status === "active" &&
      m.role === "employer_user" &&
      m.organization_id === org.id &&
      m.is_org_admin,
  );
  const responsibleOfficeName = org.parent_id ? await getOrganizationName(org.parent_id) : null;

  return (
    <div>
      <PageHeader
        title={org.trading_name || org.name}
        description="You are a Shugulika headhunting client. Recruiters run the pipeline; you review the candidate CVs they submit for your roles."
        actions={
          <Badge tone={org.verification_status === "verified" ? "success" : "warn"}>
            {titleCase(org.verification_status ?? "pending")}
          </Badge>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Registered details</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <ReadOnlyField label="Registered legal name" value={org.name} />
              <ReadOnlyField label="Legal type" value={org.legal_type} />
              <ReadOnlyField label="Country" value={org.country_code} />
              <ReadOnlyField
                label="Responsible Shugulika office"
                value={responsibleOfficeName ?? "Shugulika HQ"}
              />
              <Alert tone="info">
                Changes to the registered legal name, country, or responsible office require
                Shugulika review. Contact your responsible office to request them.
              </Alert>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Your engagement</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <ReadOnlyField label="Account type" value="Employer client (employer_user)" />
              <ReadOnlyField label="Service" value="Shugulika-managed headhunting" />
              <ReadOnlyField
                label="What you receive"
                value="Candidate name, resume, and test score after recruiter Client Submission — not the full talent database."
              />
              <ReadOnlyField
                label="Signed-in contact"
                value={session.profile?.full_name || session.email}
              />
            </CardBody>
          </Card>
        </div>
        {isAdmin ? (
          <CompanyDetailsForm org={org} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Company details</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <ReadOnlyField label="Trading name" value={org.trading_name} />
              <ReadOnlyField label="Website" value={org.website} />
              <ReadOnlyField label="Industry" value={org.industry} />
              <ReadOnlyField label="Company size" value={org.company_size} />
              <ReadOnlyField label="Region / state" value={org.region} />
              <ReadOnlyField label="City" value={org.city} />
              <ReadOnlyField label="Physical address" value={org.physical_address} />
              <ReadOnlyField label="Postal address" value={org.postal_address} />
              <p className="text-xs text-ink-subtle">
                Only your company administrator can edit these details.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-ink">{value || "—"}</p>
    </div>
  );
}
