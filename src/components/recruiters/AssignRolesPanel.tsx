"use client";

import { useState, useTransition } from "react";
import {
  assignRecruiterRoleAction,
  revokeRecruiterRoleAction,
  type RoleActionResult,
} from "@/app/hq/recruiters/actions";
import type { AssignedRole } from "@/lib/data/recruiter-kpis";
import type { JobRoleRow } from "@/lib/database.types";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { formatDate } from "@/lib/format";

export function AssignRolesPanel({
  recruiterId,
  recruiterName,
  currentAssignments,
  availableRoles,
  defaultRegion,
  regionLocked,
  regions,
}: {
  recruiterId: string;
  recruiterName: string;
  currentAssignments: AssignedRole[];
  availableRoles: JobRoleRow[];
  defaultRegion: string;
  /** When true, region select is disabled (franchise/ops). */
  regionLocked: boolean;
  regions: { code: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<RoleActionResult | null>(null);
  const [jobRoleId, setJobRoleId] = useState("");
  const [regionCode, setRegionCode] = useState(defaultRegion);

  const assignedIds = new Set(
    currentAssignments.filter((a) => a.status === "active").map((a) => a.roleId),
  );
  const assignable = availableRoles.filter((r) => !assignedIds.has(r.id));

  function onAssign(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("recruiterId", recruiterId);
    fd.set("jobRoleId", jobRoleId);
    fd.set("regionCode", regionCode);
    startTransition(async () => {
      const res = await assignRecruiterRoleAction(fd);
      setFeedback(res);
      if (res.ok) setJobRoleId("");
    });
  }

  function onRevoke(roleId: string, region: string | null) {
    const fd = new FormData();
    fd.set("recruiterId", recruiterId);
    fd.set("jobRoleId", roleId);
    if (region) fd.set("regionCode", region);
    startTransition(async () => {
      const res = await revokeRecruiterRoleAction(fd);
      setFeedback(res);
    });
  }

  return (
    <div className="space-y-6">
      {feedback ? (
        <Alert tone={feedback.ok ? "success" : "danger"} title={feedback.ok ? "Done" : "Error"}>
          {feedback.message ?? feedback.error}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Current assignments</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {currentAssignments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">No roles assigned yet.</p>
          ) : (
            <DataTable className="rounded-none border-0 shadow-none">
              <THead>
                <TR>
                  <TH>Role</TH>
                  <TH>Region</TH>
                  <TH>Status</TH>
                  <TH>Assigned</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <tbody>
                {currentAssignments.map((a) => (
                  <TR key={`${a.roleId}-${a.assignedAt}`}>
                    <TD className="font-medium">{a.roleName}</TD>
                    <TD>{a.region ?? "—"}</TD>
                    <TD>
                      <Badge tone={a.status === "active" ? "success" : "neutral"}>{a.status}</Badge>
                    </TD>
                    <TD>{formatDate(a.assignedAt)}</TD>
                    <TD>
                      {a.status === "active" ? (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={pending}
                          onClick={() => onRevoke(a.roleId, a.region)}
                        >
                          Revoke
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assign role to {recruiterName}</CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={onAssign} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium text-ink">Job role</span>
              <select
                required
                value={jobRoleId}
                onChange={(e) => setJobRoleId(e.target.value)}
                className="rounded-lg border border-surface-border bg-white px-3 py-2"
                aria-label="Select job role to assign"
              >
                <option value="">Select a role…</option>
                {assignable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-full flex-col gap-1 text-sm sm:w-40">
              <span className="font-medium text-ink">Region</span>
              <select
                required
                value={regionCode}
                onChange={(e) => setRegionCode(e.target.value)}
                disabled={regionLocked}
                className="rounded-lg border border-surface-border bg-white px-3 py-2 disabled:bg-surface-muted"
                aria-label="Assignment region"
              >
                {regions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={pending || !jobRoleId}>
              {pending ? "Saving…" : "Assign role"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
