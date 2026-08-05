import Link from "next/link";

/**
 * Expandable list of the exact applications behind a KPI number.
 *
 * Server-rendered `<details>` — no client JS — and it only ever shows
 * application IDs the loader already scoped to the viewing recruiter. No
 * candidate names, notes, or employer comments appear here.
 */
export function Drilldown({
  label,
  applicationIds,
  emptyHint = "No applications behind this number.",
  max = 50,
}: {
  label: string;
  applicationIds: string[];
  emptyHint?: string;
  max?: number;
}) {
  const shown = applicationIds.slice(0, max);
  const hidden = applicationIds.length - shown.length;

  return (
    <details className="group mt-2 border-t border-border/60 pt-2">
      <summary className="cursor-pointer list-none text-[11px] font-medium text-brand-700 hover:underline">
        <span className="group-open:hidden">Show {applicationIds.length} application IDs</span>
        <span className="hidden group-open:inline">Hide application IDs</span>
      </summary>
      <p className="mt-2 text-[11px] text-ink-subtle">{label}</p>
      {shown.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-muted">{emptyHint}</p>
      ) : (
        <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto pr-1">
          {shown.map((id) => (
            <li key={id}>
              <Link
                href={`/recruiter/applications/${id}`}
                className="font-mono text-[11px] text-brand-700 hover:underline"
              >
                {id}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <p className="mt-1 text-[11px] text-ink-subtle">+ {hidden} more not shown</p>
      ) : null}
    </details>
  );
}
