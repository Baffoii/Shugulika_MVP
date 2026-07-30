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
} from "@/components/ui/primitives";
import { ViewCvButton } from "@/components/documents/ViewCvButton";
import { UnlockCvButton } from "@/app/employer/submissions/UnlockCvButton";
import { requireEmployerSubscription } from "@/lib/auth";
import { openEmployerPoolCandidate } from "@/lib/data/employer-talent-search";
import { getEmployerPlanSnapshot } from "@/lib/employer-entitlements";
import { COUNTRIES } from "@/lib/constants";
import { FileText } from "lucide-react";

export const metadata: Metadata = { title: "Pool candidate" };

export default async function EmployerPoolCandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { employerOrg } = await requireEmployerSubscription();
  const { candidateId } = await params;
  const { job: jobOrderIdRaw } = await searchParams;
  const jobOrderId = jobOrderIdRaw?.trim() || "";

  if (!jobOrderId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Candidate" description="Path A pool teaser" />
        <Alert tone="warn" title="Job required">
          Open this candidate from Find candidates after selecting a Direct (Path A) job.
        </Alert>
        <Link
          href="/employer/find-candidates"
          className="text-sm font-medium text-brand-700 underline"
        >
          Back to Find candidates
        </Link>
      </div>
    );
  }

  const [{ candidate, error }, plan] = await Promise.all([
    openEmployerPoolCandidate(candidateId, jobOrderId),
    getEmployerPlanSnapshot(employerOrg.id),
  ]);

  if (error && !candidate) {
    return (
      <div className="space-y-4">
        <PageHeader title="Candidate" description="Path A pool teaser" />
        <Alert tone="danger" title="Cannot open profile">
          {error}
        </Alert>
        <Link
          href={`/employer/find-candidates?job=${encodeURIComponent(jobOrderId)}`}
          className="text-sm font-medium text-brand-700 underline"
        >
          Back to search
        </Link>
      </div>
    );
  }
  if (!candidate) notFound();

  const unlocked = candidate.is_unlocked;
  const displayName = unlocked
    ? candidate.full_name?.trim() ||
      [candidate.given_name, candidate.family_name].filter(Boolean).join(" ") ||
      candidate.teaser_label
    : candidate.teaser_label;
  const countryName =
    COUNTRIES.find((x) => x.code === candidate.country_code)?.name ?? candidate.country_code;
  const location = [candidate.city, countryName].filter(Boolean).join(", ");
  const backHref = `/employer/find-candidates?job=${encodeURIComponent(jobOrderId)}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={backHref} className="text-xs font-medium text-brand-700 hover:underline">
          ← Find candidates
        </Link>
        <PageHeader
          title={displayName}
          description="Anonymized until unlocked. Contact details stay inside Shugulika."
          actions={
            unlocked ? (
              <Badge tone="success">Unlocked</Badge>
            ) : (
              <Badge tone="warn">Masked teaser</Badge>
            )
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{unlocked ? "Candidate profile" : "Candidate teaser"}</CardTitle>
              <Badge tone="brand">{plan.cvUnlockBalance} unlocks left</Badge>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {!unlocked ? (
                <UnlockCvButton
                  candidateId={candidate.candidate_id}
                  jobOrderId={jobOrderId}
                  balance={plan.cvUnlockBalance}
                  teaserCopy="This is an anonymized pool teaser. Spend 1 CV unlock to reveal their name and watermarked CV inside Shugulika"
                />
              ) : null}
              {unlocked ? <Field label="Name" value={displayName} /> : null}
              <Field label="Headline" value={candidate.headline} />
              <Field label="Location" value={location || null} />
              <Field label="Availability" value={candidate.availability} />
              <Field
                label="Experience"
                value={
                  candidate.experience_years != null || candidate.experience_summary
                    ? [
                        candidate.experience_years != null
                          ? `${candidate.experience_years} yrs`
                          : null,
                        candidate.experience_summary,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : null
                }
              />
              <Field label="Education" value={candidate.education_level} />
              <Field
                label="Desired roles"
                value={
                  candidate.desired_roles.length > 0 ? candidate.desired_roles.join(", ") : null
                }
              />
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
                <Field label="Languages" value={candidate.languages.join(", ")} />
              ) : null}
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Resume
                </p>
                {unlocked && candidate.primary_cv_document_id ? (
                  <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-ink">
                      <FileText className="h-4 w-4 text-ink-subtle" aria-hidden />
                      Watermarked CV
                    </span>
                    <ViewCvButton
                      documentId={candidate.primary_cv_document_id}
                      jobOrderId={jobOrderId}
                      label="Preview CV"
                    />
                  </div>
                ) : (
                  <p className="mt-0.5 text-ink-muted">
                    {unlocked
                      ? "No CV on file for this candidate."
                      : "Unlock to preview the watermarked CV."}
                  </p>
                )}
              </div>
              <Alert tone="info">
                Email and phone are never shared with employers in this release. Reach out through
                Shugulika after unlock.
              </Alert>
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Next step</CardTitle>
            </CardHeader>
            <CardBody className="text-sm text-ink-muted">
              {unlocked ? (
                <p>You can reopen this watermarked CV anytime without spending another unlock.</p>
              ) : plan.cvUnlockBalance < 1 ? (
                <p>
                  No unlocks left.{" "}
                  <Link href="/employer/billing" className="text-brand-700 hover:underline">
                    Buy more CV unlocks
                  </Link>
                  .
                </p>
              ) : (
                <p>Spend 1 unlock to reveal identity and CV for this Direct role search.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-ink">{value || "—"}</p>
    </div>
  );
}
