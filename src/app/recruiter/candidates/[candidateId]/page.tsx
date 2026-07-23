import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Badge,
  Alert,
  EmptyState,
} from "@/components/ui/primitives";
import { SourceCandidateForm } from "@/components/candidates/SourceCandidateForm";
import {
  openDiscoveredCandidate,
  listSourceableJobs,
  listOwnOrgApplicationsForCandidate,
} from "@/lib/data/talent-search";
import { COUNTRIES, SOURCED_CONTACT_STATUSES, stageByKey } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";

export const metadata: Metadata = { title: "Discovered candidate" };

export default async function DiscoveredCandidatePage({
  params,
}: {
  params: { candidateId: string };
}) {
  const [{ candidate, error }, jobs, ownApps] = await Promise.all([
    openDiscoveredCandidate(params.candidateId),
    listSourceableJobs(),
    listOwnOrgApplicationsForCandidate(params.candidateId),
  ]);

  if (error && !candidate) {
    return (
      <div className="space-y-4">
        <PageHeader title="Candidate" description="Discovery profile" />
        <Alert tone="danger" title="Cannot open profile">
          {error}. Discovery only shows candidates who opted into search, and never exposes other
          franchises&apos; private records.
        </Alert>
        <Link href="/recruiter/candidates" className="text-sm font-medium text-brand-700 underline">
          Back to search
        </Link>
      </div>
    );
  }
  if (!candidate) notFound();

  const name =
    [candidate.given_name, candidate.family_name].filter(Boolean).join(" ") || "Candidate";
  const countryName =
    COUNTRIES.find((x) => x.code === candidate.country_code)?.name ?? candidate.country_code;
  const location = [candidate.city, countryName].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/recruiter/candidates"
          className="text-xs font-medium text-brand-700 hover:underline"
        >
          ← Candidate search
        </Link>
        <PageHeader
          title={name}
          description="Approved search fields only. Opening this profile is audited. Contact details and other franchises' notes are never shown here."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {candidate.has_own_engagement ? (
          <Badge tone="info">Already in your org&apos;s pipeline</Badge>
        ) : (
          <Badge tone="neutral">No application with your org yet</Badge>
        )}
        {candidate.open_to_work ? <Badge tone="success">Open to work</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Approved profile</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4 text-sm">
              {candidate.headline ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Headline
                  </p>
                  <p className="mt-1 text-ink">{candidate.headline}</p>
                </div>
              ) : null}
              {location ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Location
                  </p>
                  <p className="mt-1 text-ink">{location}</p>
                </div>
              ) : null}
              {candidate.availability ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Availability
                  </p>
                  <p className="mt-1 text-ink">{candidate.availability}</p>
                </div>
              ) : null}
              {candidate.experience_years != null || candidate.experience_summary ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Experience
                    {candidate.experience_years != null
                      ? ` · ${candidate.experience_years} yrs`
                      : ""}
                  </p>
                  {candidate.experience_summary ? (
                    <p className="mt-1 whitespace-pre-wrap text-ink">
                      {candidate.experience_summary}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {candidate.education_level ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Education
                  </p>
                  <p className="mt-1 text-ink">{candidate.education_level}</p>
                </div>
              ) : null}
              {candidate.desired_roles.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Desired roles
                  </p>
                  <p className="mt-1 text-ink">{candidate.desired_roles.join(", ")}</p>
                </div>
              ) : null}
              {candidate.skills.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Skills
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {candidate.skills.map((s) => (
                      <span
                        key={s}
                        className="rounded-md bg-surface-muted px-2 py-0.5 text-xs text-ink-muted"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {candidate.languages.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Languages
                  </p>
                  <p className="mt-1 text-ink">{candidate.languages.join(", ")}</p>
                </div>
              ) : null}
              {!candidate.headline &&
              !location &&
              !candidate.availability &&
              !candidate.experience_summary &&
              candidate.skills.length === 0 ? (
                <p className="text-ink-subtle">
                  This candidate is searchable but has not approved additional fields yet.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your org&apos;s applications</CardTitle>
            </CardHeader>
            <CardBody>
              {ownApps.length === 0 ? (
                <EmptyState
                  title="No applications yet"
                  description="Source this candidate onto a job to start a franchise-private pipeline record."
                />
              ) : (
                <ul className="space-y-2">
                  {ownApps.map((a) => {
                    const contactLabel = SOURCED_CONTACT_STATUSES.find(
                      (s) => s.key === a.sourced_contact_status,
                    )?.label;
                    return (
                      <li key={a.id}>
                        <Link
                          href={`/recruiter/applications/${a.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border px-3 py-2 hover:border-brand-300"
                        >
                          <div>
                            <p className="text-sm font-medium text-ink">{a.job_title ?? "Job"}</p>
                            <p className="text-xs text-ink-subtle">
                              {a.entry_source === "recruiter_sourced" ? "Sourced" : "Applied"}
                              {contactLabel ? ` · ${contactLabel}` : ""}
                              {a.withdrawn_at ? " · Withdrawn" : ""}
                            </p>
                          </div>
                          <StatusBadge
                            status={a.withdrawn_at ? "withdrawn" : a.current_stage}
                            label={
                              a.withdrawn_at ? "Withdrawn" : stageByKey(a.current_stage)?.label
                            }
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Source to a job</CardTitle>
            </CardHeader>
            <CardBody>
              <SourceCandidateForm
                candidateId={candidate.candidate_id}
                candidateName={name}
                jobs={jobs}
              />
            </CardBody>
          </Card>
          <Alert tone="info" title="Privacy boundary">
            Other franchises&apos; notes, tags, rejections, and applications are never visible here.
            Full profile access starts only after you create an application for your organization.
          </Alert>
        </div>
      </div>
    </div>
  );
}
