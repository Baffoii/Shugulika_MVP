"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/form";

export type PathAJobOption = {
  id: string;
  title: string;
  city: string | null;
  country_code: string | null;
  status: string;
};

/** Selects which Direct (Path A) job scopes the anonymized pool search. */
export function PathAJobPicker({
  jobs,
  basePath = "/employer/find-candidates",
}: {
  jobs: PathAJobOption[];
  basePath?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("job") ?? "";

  return (
    <div className="card p-4">
      <label htmlFor="path-a-job" className="label-base">
        Search for this Direct role
      </label>
      <Select
        id="path-a-job"
        className="mt-1"
        value={selected}
        onChange={(e) => {
          const sp = new URLSearchParams(params.toString());
          const next = e.target.value;
          if (next) sp.set("job", next);
          else sp.delete("job");
          const qs = sp.toString();
          router.push(qs ? `${basePath}?${qs}` : basePath);
        }}
      >
        <option value="">Select a Path A job…</option>
        {jobs.map((j) => {
          const loc = [j.city, j.country_code].filter(Boolean).join(", ");
          return (
            <option key={j.id} value={j.id}>
              {j.title}
              {loc ? ` · ${loc}` : ""} ({j.status})
            </option>
          );
        })}
      </Select>
      <p className="mt-2 text-xs text-ink-subtle">
        Pool search is only available for Direct (Path A) jobs you posted. Managed (Path B) roles
        receive candidates via Shugulika submissions instead.
      </p>
    </div>
  );
}
