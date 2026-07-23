import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, EmptyState, Badge, Alert } from "@/components/ui/primitives";
import { CandidateSearchFilters } from "@/components/candidates/CandidateSearchFilters";
import { searchTalentPool } from "@/lib/data/talent-search";
import { COUNTRIES } from "@/lib/constants";
import { MapPin, Briefcase } from "lucide-react";

export const metadata: Metadata = { title: "Candidates" };

export default async function RecruiterCandidatesPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    skill?: string;
    country?: string;
    city?: string;
    availability?: string;
    experience_level?: string;
  };
}) {
  const { candidates, error } = await searchTalentPool({
    q: searchParams.q,
    skill: searchParams.skill,
    country: searchParams.country,
    city: searchParams.city,
    availability: searchParams.availability,
    experience_level: searchParams.experience_level,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidate search"
        description="Discover candidates who opted into recruiter search. Only approved fields are shown — never private franchise records or contact details."
      />

      <Suspense fallback={<div className="card h-28 animate-pulse bg-surface-muted" />}>
        <CandidateSearchFilters />
      </Suspense>

      {error ? (
        <Alert tone="danger" title="Search unavailable">
          {error}
        </Alert>
      ) : null}

      {candidates.length === 0 && !error ? (
        <EmptyState
          title="No matching candidates"
          description="Try clearing filters, or ask candidates to opt into recruiter discovery in Settings."
        />
      ) : (
        <ul className="divide-y divide-surface-border rounded-xl border border-surface-border bg-white">
          {candidates.map((c) => {
            const name = [c.given_name, c.family_name].filter(Boolean).join(" ") || "Candidate";
            const countryName =
              COUNTRIES.find((x) => x.code === c.country_code)?.name ?? c.country_code;
            const location = [c.city, countryName].filter(Boolean).join(", ");
            return (
              <li key={c.candidate_id}>
                <Link
                  href={`/recruiter/candidates/${c.candidate_id}`}
                  className="block px-4 py-4 hover:bg-surface-muted/60 sm:px-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{name}</p>
                      {c.headline ? (
                        <p className="mt-0.5 truncate text-sm text-ink-muted">{c.headline}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.has_own_engagement ? (
                        <Badge tone="info">In your pipeline</Badge>
                      ) : (
                        <Badge tone="neutral">Not contacted by you</Badge>
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
                        <span className="text-2xs text-ink-subtle">+{c.skills.length - 6}</span>
                      ) : null}
                    </div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
