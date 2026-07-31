import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, EmptyState, Badge, Alert, ButtonLink } from "@/components/ui/primitives";
import { CandidateSearchFilters } from "@/components/candidates/CandidateSearchFilters";
import { PathAJobPicker } from "@/components/employer/PathAJobPicker";
import { requireEmployerSubscription } from "@/lib/auth";
import { listEmployerPathAJobs, searchEmployerTalentPool } from "@/lib/data/employer-talent-search";
import { getEmployerPlanSnapshot } from "@/lib/employer-entitlements";
import { COUNTRIES } from "@/lib/constants";
import { MapPin, Briefcase, ChevronLeft, ChevronRight } from "lucide-react";

export const metadata: Metadata = { title: "Find candidates" };

function buildPageHref(filters: Record<string, string | undefined>, page: number): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) sp.set(k, v);
  }
  if (page > 1) sp.set("page", String(page));
  else sp.delete("page");
  const qs = sp.toString();
  return qs ? `/employer/find-candidates?${qs}` : "/employer/find-candidates";
}

/** Page numbers with gaps for compact navigation (e.g. 1 2 3 4 5 6 7 … 20). */
function buildPaginationItems(current: number, total: number): Array<number | "gap"> {
  if (total <= 9) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, total]);
  for (let i = current - 2; i <= current + 2; i++) {
    if (i >= 1 && i <= total) pages.add(i);
  }
  if (current <= 5) {
    for (let i = 1; i <= 7; i++) pages.add(i);
  }
  if (current >= total - 4) {
    for (let i = Math.max(1, total - 6); i <= total; i++) pages.add(i);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const items: Array<number | "gap"> = [];
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (i > 0 && n - sorted[i - 1]! > 1) items.push("gap");
    items.push(n);
  }
  return items;
}

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
    industry?: string;
    qualification?: string;
    role?: string;
    page?: string;
  }>;
}) {
  const { employerOrg } = await requireEmployerSubscription();
  const filters = await searchParams;
  const jobOrderId = filters.job?.trim() || "";
  const page = Math.max(Number.parseInt(filters.page ?? "1", 10) || 1, 1);

  const [jobs, plan] = await Promise.all([
    listEmployerPathAJobs(employerOrg.id),
    getEmployerPlanSnapshot(employerOrg.id),
  ]);

  const selectedJob = jobs.find((j) => j.id === jobOrderId) ?? null;
  const jobValid = Boolean(selectedJob);

  const { candidates, totalCount, pageSize, error } =
    jobValid && jobOrderId
      ? await searchEmployerTalentPool(jobOrderId, {
          q: filters.q,
          skill: filters.skill,
          country: filters.country,
          city: filters.city,
          availability: filters.availability,
          experience_level: filters.experience_level,
          industry: filters.industry,
          qualification: filters.qualification,
          role: filters.role,
          page,
          pageSize: 20,
        })
      : { candidates: [], totalCount: 0, pageSize: 20, error: null };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const filterState = {
    job: jobOrderId || undefined,
    q: filters.q,
    skill: filters.skill,
    country: filters.country,
    city: filters.city,
    availability: filters.availability,
    experience_level: filters.experience_level,
    industry: filters.industry,
    qualification: filters.qualification,
    role: filters.role,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Find candidates"
        description="Search Shugulika’s Zoho Recruit candidate cache for your Direct (Path A) roles. Teasers are anonymized — spend a CV unlock to reveal identity and a watermarked CV."
        actions={
          <Badge tone="brand">
            {plan.cvUnlockBalance} unlock{plan.cvUnlockBalance === 1 ? "" : "s"} left
          </Badge>
        }
      />

      <Alert tone="info">
        Results come from the HQ-synced Zoho Candidates cache (structured fields only — resume file
        text is not indexed). Browse teasers free. Unlock reveals name and a watermarked CV preview.
        For Managed (Path B) roles, use{" "}
        <Link href="/employer/submissions" className="font-medium underline">
          Candidate CVs
        </Link>
        . Top up unlocks in{" "}
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
                  keywordPlaceholder="Role, skill, industry…"
                  showExtendedFilters
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
                  description={`No synced Zoho candidates match for “${selectedJob?.title ?? "this role"}”. Ask HQ to run Sync candidates from Zoho, or clear filters.`}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-white px-4 py-2.5 text-sm text-ink-muted">
                    <p>
                      <span className="font-medium text-ink">{totalCount.toLocaleString()}</span>{" "}
                      candidate{totalCount === 1 ? "" : "s"}
                    </p>
                    <p>
                      Page{" "}
                      <span className="font-medium text-ink">
                        {page} of {totalPages}
                      </span>
                      <span className="text-ink-subtle">
                        {" "}
                        · showing {(page - 1) * pageSize + 1}–
                        {(page - 1) * pageSize + candidates.length}
                      </span>
                    </p>
                  </div>
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
                                {c.has_resume ? <Badge tone="neutral">CV on file</Badge> : null}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
                              {location ? (
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                                  {location}
                                </span>
                              ) : null}
                              {c.industry ? (
                                <span className="inline-flex items-center gap-1">
                                  <Briefcase className="h-3.5 w-3.5" aria-hidden />
                                  {c.industry}
                                </span>
                              ) : null}
                              {c.availability ? <span>{c.availability}</span> : null}
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
                  {totalPages > 1 ? (
                    <nav
                      aria-label="Search results pages"
                      className="flex flex-wrap items-center justify-center gap-2 sm:gap-3"
                    >
                      {page > 1 ? (
                        <ButtonLink
                          href={buildPageHref(filterState, page - 1)}
                          variant="outline"
                          size="sm"
                          className="rounded-full px-4"
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden />
                          Prev
                        </ButtonLink>
                      ) : (
                        <span
                          aria-disabled="true"
                          className="inline-flex items-center gap-2 rounded-full border border-surface-border bg-white px-4 py-1.5 text-sm font-medium text-ink-subtle opacity-50"
                        >
                          <ChevronLeft className="h-4 w-4" aria-hidden />
                          Prev
                        </span>
                      )}

                      <ol className="flex items-center gap-1 sm:gap-1.5">
                        {buildPaginationItems(page, totalPages).map((item, idx) =>
                          item === "gap" ? (
                            <li
                              key={`gap-${idx}`}
                              className="px-1 text-sm text-ink-subtle"
                              aria-hidden
                            >
                              …
                            </li>
                          ) : (
                            <li key={item}>
                              {item === page ? (
                                <span
                                  aria-current="page"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white"
                                >
                                  {item}
                                </span>
                              ) : (
                                <Link
                                  href={buildPageHref(filterState, item)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                                >
                                  {item}
                                </Link>
                              )}
                            </li>
                          ),
                        )}
                      </ol>

                      {page < totalPages ? (
                        <ButtonLink
                          href={buildPageHref(filterState, page + 1)}
                          variant="outline"
                          size="sm"
                          className="rounded-full px-4"
                        >
                          Next
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </ButtonLink>
                      ) : (
                        <span
                          aria-disabled="true"
                          className="inline-flex items-center gap-2 rounded-full border border-surface-border bg-white px-4 py-1.5 text-sm font-medium text-ink-subtle opacity-50"
                        >
                          Next
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </span>
                      )}
                    </nav>
                  ) : null}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
