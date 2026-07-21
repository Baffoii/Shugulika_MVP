import type { AssignedRole } from "@/lib/data/recruiter-kpis";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/format";

export function RoleAssignmentTable({
  roles,
  note = "Role assignments are managed by HQ, Operations, or Franchise admins.",
}: {
  roles: AssignedRole[];
  note?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assigned roles</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {roles.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            No roles assigned yet. Ask your admin to assign sourcing roles.
          </p>
        ) : (
          <DataTable className="rounded-none border-0 shadow-none">
            <THead>
              <TR>
                <TH>Role name</TH>
                <TH>Region</TH>
                <TH>Active</TH>
                <TH>Assigned</TH>
              </TR>
            </THead>
            <tbody>
              {roles.map((r) => (
                <TR key={`${r.roleId}-${r.assignedAt}`}>
                  <TD className="font-medium">{r.roleName}</TD>
                  <TD>{r.region ?? "—"}</TD>
                  <TD>
                    <Badge tone={r.status === "active" ? "success" : "neutral"}>
                      {r.status === "active" ? "Yes" : "No"}
                    </Badge>
                  </TD>
                  <TD>{formatDate(r.assignedAt)}</TD>
                </TR>
              ))}
            </tbody>
          </DataTable>
        )}
        <p className="border-t border-surface-border px-5 py-3 text-xs text-ink-subtle">{note}</p>
      </CardBody>
    </Card>
  );
}
