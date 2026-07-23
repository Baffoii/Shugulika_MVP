import type { Metadata } from "next";
import { PageHeader, EmptyState, Alert, Badge } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { auditActionTone } from "@/components/StatusBadge";
import { getHqAuditLog } from "@/lib/data/staff";
import { formatDateTime, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditLogPage() {
  const logs = await getHqAuditLog(100);

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only record of sensitive actions. These entries are not editable through the application interface."
      />
      <div className="mb-4">
        <Alert tone="info">
          Tracked: stage changes, rejections, submissions, employer decisions, recruiter
          assignments, and other consequential actions — with resolved people, companies, and roles.
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
              <TH>Organization</TH>
              <TH>Actor</TH>
            </TR>
          </THead>
          <tbody>
            {logs.map((log) => (
              <TR key={log.id}>
                <TD className="whitespace-nowrap text-ink-muted">
                  {formatDateTime(log.created_at)}
                </TD>
                <TD>
                  <Badge tone={auditActionTone(log.action)}>{titleCase(log.action)}</Badge>
                </TD>
                <TD>
                  <p className="font-medium text-ink">{log.entity_label}</p>
                  {log.detail ? (
                    <p className="mt-1 text-sm font-semibold text-ink-muted">{log.detail}</p>
                  ) : null}
                </TD>
                <TD className="text-ink-muted">{log.org_name ?? "—"}</TD>
                <TD className="text-ink">{log.actor_name}</TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
