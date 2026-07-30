import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, EmptyState, Badge, Alert } from "@/components/ui/primitives";
import { CandidateSearchFilters } from "@/components/candidates/CandidateSearchFilters";
import { PathAJobPicker } from "@/components/employer/PathAJobPicker";
import { requireEmployerSubscription } from "@/lib/auth";
import { listEmployerPathAJobs, searchEmployerTalentPool } from "@/lib/data/employer-talent-search";
import { getEmployerPlanSnapshot } from "@/lib/employer-entitlements";
import { COUNTRIES } from "@/lib/constants";
import { MapPin, Briefcase } from "lucide-react";

export const metadata: Metadata = { title: "Find candidates" };

export default async function EmployerFindCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    job?: string;
    q?: string;
    skill?: string;
    country?: string;
    city?: string;
    availability?: string;
    experience_level?: string;
  }>;
}) {
  const { employerOrg } = await requireEmployerSubscription();
  const filters = await searchParams;
  const jobOrderId = filters.job?.trim() || "";

  const [jobs, plan] = await Promise.all([
    listEmployerPathAJobs(employerOrg.id),
    getEmployerPlanSnapshot(employerOrg.id),
  ]);

  const selectedJob = jobs.find((j) => j.id === jobOrderId) ?? null;
  const jobValid = Boolean(selectedJob);

  const { candidates, error } =
    jobValid && jobOrderId
      ? await searchEmployerTalentPool(jobOrderId, {
          q: filters.q,
          skill: filters.skill,
          country: filters.country,
          city: filters.city,
          availability: filters.availability,
          experience_level: filters.experience_level,
        })
      : { candidates: [], error: null };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Find candidates"
        description="Search Shugulika’s opted-in pool for your Direct (Path A) roles. Teasers are anonymized — spend a CV unlock to reveal identity and a watermarked CV."
        actions={
          <Badge tone="brand">
            {plan.cvUnlockBalance} unlock{plan.cvUnlockBalance === 1 ? "" : "s"} left
          </Badge>
        }
      />

      <Alert tone="info">
        Browse teasers free. Unlock reveals name and CV inside Shugulika (no contact export). For
        Managed (Path B) roles, use{" "}
        <Link href="/employer/submissions" className="font-medium underline">
          Candidate CVs
        </Link>{" "}
        from Shugulika instead. Top up unlocks in{" "}
        <Link href="/employer/billing" className="font-medium underline">
          Billing
        </Link>
        .
      </Alert>

      {jobs.length === 0 ? (
        <EmptyState
          title="No Direct roles yet"
          description="Post a Direct (Path A) job order to search the candidate pool yourself. Managed roles receive packs via Shugulika submissions."
          action={
            <Link
              href="/employer/job-orders"
              className="text-sm font-medium text-brand-700 underline"
            >
              Post a job order
            </Link>
          }
        />
      ) : (
        <>
          <Suspense fallback={<div className="card h-24 animate-pulse bg-surface-muted" />}>
            <PathAJobPicker jobs={jobs} />
          </Suspense>

          {!jobValid ? (
            <EmptyState
              title="Select a Direct role"
              description="Choose which Path A job this search is for. Filters and unlocks stay scoped to that role."
            />
          ) : (
            <>
              <Suspense fallback={<div className="card h-28 animate-pulse bg-surface-muted" />}>
                <CandidateSearchFilters
                  basePath="/employer/find-candidates"
                  preserveParams={["job"]}
                  keywordPlaceholder="Role, skill, headline…"
                />
              </Suspense>

              {error ? (
                <Alert tone="danger" title="Search unavailable">
                  {error}
                </Alert>
              ) : null}

              {candidates.length === 0 && !error ? (
                <EmptyState
                  title="No matching candidates"
                  description={`No opted-in pool matches for “${selectedJob?.title ?? "this role"}”. Try clearing filters.`}
                />
              ) : (
                <ul className="divide-y divide-surface-border rounded-xl border border-surface-border bg-white">
                  {candidates.map((c) => {
                    const displayName = c.is_unlocked
                      ? c.full_name?.trim() ||
                        [c.given_name, c.family_name].filter(Boolean).join(" ") ||
                        c.teaser_label
                      : c.teaser_label;
                    const countryName =
                      COUNTRIES.find((x) => x.code === c.country_code)?.name ?? c.country_code;
                    const location = [c.city, countryName].filter(Boolean).join(", ");
                    const href = `/employer/find-candidates/${c.candidate_id}?job=${encodeURIComponent(jobOrderId)}`;
                    return (
                      <li key={c.candidate_id}>
                        <Link
                          href={href}
                          className="block px-4 py-4 hover:bg-surface-muted/60 sm:px-5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-ink">{displayName}</p>
                              {c.headline ? (
                                <p className="mt-0.5 truncate text-sm text-ink-muted">
                                  {c.headline}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {c.is_unlocked ? (
                                <Badge tone="success">Unlocked</Badge>
                              ) : (
                                <Badge tone="warn">Masked teaser</Badge>
                              )}
                              {c.open_to_work ? <Badge tone="success">Open to work</Badge> : null}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
                            {location ? (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5" aria-hidden />
                                {location}
                              </span>
                            ) : null}
                            {c.availability ? (
                              <span className="inline-flex items-center gap-1">
                                <Briefcase className="h-3.5 w-3.5" aria-hidden />
                                {c.availability}
                              </span>
                            ) : null}
                            {c.experience_years != null ? (
                              <span>{c.experience_years} yrs experience</span>
                            ) : null}
                          </div>
                          {c.skills.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {c.skills.slice(0, 6).map((s) => (
                                <span
                                  key={s}
                                  className="rounded-md bg-surface-muted px-2 py-0.5 text-2xs text-ink-muted"
                                >
                                  {s}
                                </span>
                              ))}
                              {c.skills.length > 6 ? (
                                <span className="text-2xs text-ink-subtle">
                                  +{c.skills.length - 6}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
