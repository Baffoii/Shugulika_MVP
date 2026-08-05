import { Card, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import type { FranchiseTargetHistoryEntry } from "@/lib/data/franchise-ops";

export function FranchiseTargetHistoryPanel({
  entries,
}: {
  entries: FranchiseTargetHistoryEntry[];
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No target changes yet"
        description="When franchise administrators update KPI targets, the change history appears here."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target change history</CardTitle>
      </CardHeader>
      <DataTable className="border-0 shadow-none">
        <THead>
          <TR>
            <TH>When</TH>
            <TH>Actor</TH>
            <TH>Action</TH>
            <TH>Level</TH>
            <TH>Before → After</TH>
          </TR>
        </THead>
        <tbody>
          {entries.map((e) => (
            <TR key={e.id}>
              <TD className="whitespace-nowrap text-ink-muted">{formatDateTime(e.createdAt)}</TD>
              <TD>{e.actorName}</TD>
              <TD className="font-mono text-xs">{e.action}</TD>
              <TD className="capitalize">{e.level?.replace(/_/g, " ") ?? "—"}</TD>
              <TD>
                <pre className="max-w-md overflow-x-auto whitespace-pre-wrap text-xs text-ink-muted">
                  {JSON.stringify({ before: e.beforeValue, after: e.afterValue }, null, 0)}
                </pre>
              </TD>
            </TR>
          ))}
        </tbody>
      </DataTable>
    </Card>
  );
}
