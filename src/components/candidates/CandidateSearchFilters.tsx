"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/primitives";
import { AVAILABILITY_PRESETS, COUNTRIES, EXPERIENCE_LEVELS } from "@/lib/constants";

/** Talent-pool filter bar — pushes filters into the URL query string. */
export function CandidateSearchFilters({
  basePath = "/recruiter/candidates",
  preserveParams = [],
  keywordPlaceholder = "Name, role, skill…",
  showExtendedFilters = false,
}: {
  basePath?: string;
  /** Query keys to keep when clearing (e.g. employer job scope). */
  preserveParams?: string[];
  keywordPlaceholder?: string;
  /** Industry / qualification / role filters (employer Zoho search). */
  showExtendedFilters?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [skill, setSkill] = useState(params.get("skill") ?? "");
  const [industry, setIndustry] = useState(params.get("industry") ?? "");
  const [qualification, setQualification] = useState(params.get("qualification") ?? "");
  const [role, setRole] = useState(params.get("role") ?? "");

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    // Reset paging when filters change.
    if (!("page" in next)) sp.delete("page");
    router.push(`${basePath}?${sp.toString()}`);
  }

  function clearFilters() {
    setQ("");
    setSkill("");
    setIndustry("");
    setQualification("");
    setRole("");
    const sp = new URLSearchParams();
    for (const key of preserveParams) {
      const v = params.get(key);
      if (v) sp.set(key, v);
    }
    const qs = sp.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        update({
          q,
          skill,
          ...(showExtendedFilters ? { industry, qualification, role } : {}),
        });
      }}
      className="card flex flex-col gap-3 p-4"
      role="search"
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <label htmlFor="cand-q" className="label-base">
            Keyword
          </label>
          <div className="relative mt-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
              aria-hidden
            />
            <Input
              id="cand-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={keywordPlaceholder}
              className="pl-9"
            />
          </div>
        </div>
        <div>
          <label htmlFor="cand-skill" className="label-base">
            Skill
          </label>
          <Input
            id="cand-skill"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            placeholder="e.g. React, Nursing…"
            className="mt-1"
          />
        </div>
      </div>
      {showExtendedFilters ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <div>
            <label htmlFor="cand-role" className="label-base">
              Role / title
            </label>
            <Input
              id="cand-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. IT Support"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="cand-industry" className="label-base">
              Industry
            </label>
            <Input
              id="cand-industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Technology"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="cand-qual" className="label-base">
              Qualification
            </label>
            <Input
              id="cand-qual"
              value={qualification}
              onChange={(e) => setQualification(e.target.value)}
              placeholder="e.g. Bachelor"
              className="mt-1"
            />
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="cand-country" className="label-base">
            Country
          </label>
          <Select
            id="cand-country"
            defaultValue={params.get("country") ?? ""}
            onChange={(e) => update({ country: e.target.value, q, skill })}
            className="mt-1"
          >
            <option value="">All</option>
            {COUNTRIES.filter((c) => c.active).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="cand-city" className="label-base">
            City
          </label>
          <Input
            id="cand-city"
            defaultValue={params.get("city") ?? ""}
            onBlur={(e) => update({ city: e.target.value.trim(), q, skill })}
            placeholder="City"
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="cand-exp" className="label-base">
            Experience
          </label>
          <Select
            id="cand-exp"
            defaultValue={params.get("experience_level") ?? ""}
            onChange={(e) => update({ experience_level: e.target.value, q, skill })}
            className="mt-1"
          >
            <option value="">All</option>
            {EXPERIENCE_LEVELS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="cand-avail" className="label-base">
            Availability
          </label>
          <Select
            id="cand-avail"
            defaultValue={params.get("availability") ?? ""}
            onChange={(e) => update({ availability: e.target.value, q, skill })}
            className="mt-1"
          >
            <option value="">All</option>
            {AVAILABILITY_PRESETS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Search</Button>
        <Button type="button" variant="outline" onClick={clearFilters}>
          Clear
        </Button>
      </div>
    </form>
  );
}
