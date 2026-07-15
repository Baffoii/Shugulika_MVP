"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/primitives";
import { COUNTRIES, EMPLOYMENT_TYPES, WORK_ARRANGEMENTS, EXPERIENCE_LEVELS } from "@/lib/constants";

/** Public job board filter bar. Pushes filters into the URL query string. */
export function JobFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`/jobs?${sp.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        update({ q });
      }}
      className="card flex flex-col gap-3 p-4 lg:flex-row lg:items-end"
      role="search"
    >
      <div className="flex-1">
        <label htmlFor="job-q" className="label-base">
          Keyword
        </label>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <Input id="job-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job title, company, skill…" className="pl-9" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="f-country" className="label-base">Country</label>
          <Select id="f-country" defaultValue={params.get("country") ?? ""} onChange={(e) => update({ country: e.target.value })} className="mt-1">
            <option value="">All</option>
            {COUNTRIES.filter((c) => c.active).map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-type" className="label-base">Type</label>
          <Select id="f-type" defaultValue={params.get("employment_type") ?? ""} onChange={(e) => update({ employment_type: e.target.value })} className="mt-1">
            <option value="">All</option>
            {EMPLOYMENT_TYPES.map((t) => (<option key={t.key} value={t.key}>{t.label}</option>))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-arr" className="label-base">Workplace</label>
          <Select id="f-arr" defaultValue={params.get("work_arrangement") ?? ""} onChange={(e) => update({ work_arrangement: e.target.value })} className="mt-1">
            <option value="">All</option>
            {WORK_ARRANGEMENTS.map((t) => (<option key={t.key} value={t.key}>{t.label}</option>))}
          </Select>
        </div>
        <div>
          <label htmlFor="f-exp" className="label-base">Level</label>
          <Select id="f-exp" defaultValue={params.get("experience_level") ?? ""} onChange={(e) => update({ experience_level: e.target.value })} className="mt-1">
            <option value="">All</option>
            {EXPERIENCE_LEVELS.map((t) => (<option key={t.key} value={t.key}>{t.label}</option>))}
          </Select>
        </div>
      </div>
      <Button type="submit" className="lg:mb-0">Search</Button>
    </form>
  );
}
