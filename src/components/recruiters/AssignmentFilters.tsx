import Link from "next/link";

/** Server-rendered GET filters — avoids client navigation hooks on this page. */
export function AssignmentFilters({
  basePath,
  recruiters,
  regions,
  recruiter,
  region,
}: {
  basePath: string;
  recruiters: { id: string; name: string }[];
  regions: { code: string; name: string }[];
  recruiter?: string;
  region?: string;
}) {
  const hasFilters = Boolean(recruiter || region);

  return (
    <form
      method="get"
      action={basePath}
      className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="min-w-[12rem] flex-1">
        <label htmlFor="filter-recruiter" className="label-base">
          Recruiter
        </label>
        <select
          id="filter-recruiter"
          name="recruiter"
          className="input-base mt-1"
          defaultValue={recruiter ?? ""}
        >
          <option value="">All recruiters</option>
          {recruiters.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-[10rem] flex-1">
        <label htmlFor="filter-region" className="label-base">
          Region
        </label>
        <select
          id="filter-region"
          name="region"
          className="input-base mt-1"
          defaultValue={region ?? ""}
        >
          <option value="">All regions</option>
          {regions.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Apply
        </button>
        {hasFilters ? (
          <Link href={basePath} className="text-sm font-medium text-brand-700 hover:text-brand-800">
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
