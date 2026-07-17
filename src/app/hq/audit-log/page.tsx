import type { Metadata } from "next";
import { PageHeader, EmptyState, Alert, Badge } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, titleCase } from "@/lib/format";
import type { AuditLogRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  const logs = (data as AuditLogRow[] | null) ?? [];

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only record of sensitive actions. These entries are not editable through the application interface."
      />
      <div className="mb-4">
        <Alert tone="info">
          Tracked: stage changes, rejections, submissions, employer decisions, and other
          consequential actions, with actor, entity, and before/after values.
        </Alert>
      </div>
      {logs.length === 0 ? (
        <EmptyState
          title="No audit entries yet"
          description="As users act across the platform, sensitive actions will be recorded here."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Action</TH>
              <TH>Entity</TH>
              <TH>Actor</TH>
            </TR>
          </THead>
          <tbody>
            {logs.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap text-ink-muted">{formatDateTime(l.created_at)}</TD>
                <TD>
                  <Badge tone="neutral">{titleCase(l.action)}</Badge>
                </TD>
                <TD className="text-ink-muted">
                  {titleCase(l.entity_type)} {l.entity_id ? l.entity_id.slice(0, 8) : ""}
                </TD>
                <TD className="text-ink-subtle">
                  {l.actor_id ? l.actor_id.slice(0, 8) : "system"}
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
