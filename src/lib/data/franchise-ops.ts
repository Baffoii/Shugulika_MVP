import { createClient } from "@/lib/supabase/server";
import type { EmployerApplicationRow, OrganizationRow, ProfileRow } from "@/lib/database.types";
import type { EmployerApplicationOpsFields } from "@/lib/franchise/types";
import { applicationAgeHours, isSlaOverdue } from "@/lib/franchise/employer-app-ops";
import type { FranchiseSortMode } from "@/lib/franchise/types";
import type { DateWindow } from "@/lib/kpi/definitions";
import { FRANCHISE_FINANCE_ATTRIBUTION_FLAG } from "@/lib/franchise/types";

export type FranchiseEmployerApplicationRow = EmployerApplicationRow &
  EmployerApplicationOpsFields & {
    applicant_name: string;
    applicant_email: string;
    assigned_org_name: string;
    owner_name: string | null;
    age_hours: number | null;
    sla_overdue: boolean;
  };

export type FranchiseEmployerAppFilters = {
  status?: string;
  country?: string;
  ownerUserId?: string;
  nextAction?: string;
  slaOnly?: boolean;
  sort?: FranchiseSortMode;
};

function asOps(row: EmployerApplicationRow): EmployerApplicationOpsFields {
  const r = row as EmployerApplicationRow & Partial<EmployerApplicationOpsFields>;
  return {
    owner_user_id: r.owner_user_id ?? null,
    sla_due_at: r.sla_due_at ?? null,
    next_action: r.next_action ?? null,
  };
}

/**
 * Review queue with ops columns. RLS already scopes rows before filtering.
 * Never accepts a foreign franchise org id — scope is enforced by policies.
 */
export async function listFranchiseEmployerApplications(
  filters: FranchiseEmployerAppFilters = {},
): Promise<FranchiseEmployerApplicationRow[]> {
  const supabase = createClient();
  let query = supabase
    .from("employer_applications")
    .select("*")
    .neq("status", "draft")
    .order("submitted_at", { ascending: false, nullsFirst: false });

  if (filters.status) {
    query = query.eq("status", filters.status as NonNullable<EmployerApplicationRow["status"]>);
  }
  if (filters.country) query = query.eq("country_code", filters.country);
  const opsQuery = query as unknown as {
    eq: (col: string, val: string) => typeof query;
    is: (col: string, val: null) => typeof query;
  };
  if (filters.ownerUserId === "unassigned") query = opsQuery.is("owner_user_id", null);
  else if (filters.ownerUserId) query = opsQuery.eq("owner_user_id", filters.ownerUserId);
  if (filters.nextAction) query = opsQuery.eq("next_action", filters.nextAction);

  const { data } = await query;
  const rows = (data as EmployerApplicationRow[] | null) ?? [];
  const enriched = await enrichFranchiseApplications(rows);

  let filtered = enriched;
  if (filters.slaOnly) {
    filtered = filtered.filter((r) => r.sla_overdue);
  }

  return sortFranchiseApplications(filtered, filters.sort ?? "sla_first");
}

function sortFranchiseApplications(
  rows: FranchiseEmployerApplicationRow[],
  sort: FranchiseSortMode,
): FranchiseEmployerApplicationRow[] {
  const copy = [...rows];
  switch (sort) {
    case "alpha_asc":
      copy.sort((a, b) =>
        (a.legal_name ?? "").localeCompare(b.legal_name ?? "", undefined, {
          sensitivity: "base",
        }),
      );
      break;
    case "alpha_desc":
      copy.sort((a, b) =>
        (b.legal_name ?? "").localeCompare(a.legal_name ?? "", undefined, {
          sensitivity: "base",
        }),
      );
      break;
    case "oldest":
      copy.sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
      break;
    case "newest":
      copy.sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
      break;
    case "sla_first":
    default:
      copy.sort((a, b) => {
        if (a.sla_overdue !== b.sla_overdue) return a.sla_overdue ? -1 : 1;
        const aDue = a.sla_due_at ?? "9999";
        const bDue = b.sla_due_at ?? "9999";
        return aDue.localeCompare(bDue);
      });
      break;
  }
  return copy;
}

async function enrichFranchiseApplications(
  rows: EmployerApplicationRow[],
): Promise<FranchiseEmployerApplicationRow[]> {
  if (rows.length === 0) return [];
  const supabase = createClient();
  const userIds = [
    ...new Set([
      ...rows.map((r) => r.applicant_user_id),
      ...rows.map((r) => asOps(r).owner_user_id).filter((v): v is string => !!v),
    ]),
  ];
  const orgIds = [...new Set(rows.map((r) => r.assigned_org_id).filter((v): v is string => !!v))];
  const [{ data: profiles }, { data: orgs }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email").in("id", userIds),
    orgIds.length
      ? supabase.from("organizations").select("id,name").in("id", orgIds)
      : Promise.resolve({ data: [] as Pick<OrganizationRow, "id" | "name">[] }),
  ]);
  const profileById = new Map(
    ((profiles as Pick<ProfileRow, "id" | "full_name" | "email">[] | null) ?? []).map((p) => [
      p.id,
      p,
    ]),
  );
  const orgById = new Map(
    ((orgs as Pick<OrganizationRow, "id" | "name">[] | null) ?? []).map((o) => [o.id, o.name]),
  );

  return rows.map((row) => {
    const ops = asOps(row);
    return {
      ...row,
      ...ops,
      applicant_name: profileById.get(row.applicant_user_id)?.full_name ?? "—",
      applicant_email: profileById.get(row.applicant_user_id)?.email ?? "",
      assigned_org_name: row.assigned_org_id
        ? (orgById.get(row.assigned_org_id) ?? "Assigned office")
        : "Shugulika HQ",
      owner_name: ops.owner_user_id ? (profileById.get(ops.owner_user_id)?.full_name ?? "—") : null,
      age_hours: applicationAgeHours(row.submitted_at),
      sla_overdue: isSlaOverdue(ops.sla_due_at, row.status),
    };
  });
}

export async function listFranchiseAssignableOwners(
  franchiseOrgId: string,
): Promise<{ id: string; name: string; email: string }[]> {
  const supabase = createClient();
  const { data: mems } = await supabase
    .from("memberships")
    .select("user_id,role")
    .eq("organization_id", franchiseOrgId)
    .eq("status", "active")
    .in("role", ["franchise_admin", "operations", "recruiter", "accounts"]);
  const userIds = [
    ...new Set(((mems as { user_id: string }[] | null) ?? []).map((m) => m.user_id)),
  ];
  if (userIds.length === 0) return [];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,full_name,email")
    .in("id", userIds);
  return ((profiles as Pick<ProfileRow, "id" | "full_name" | "email">[] | null) ?? [])
    .map((p) => ({
      id: p.id,
      name: p.full_name || p.email,
      email: p.email,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type EmployerHealthRow = {
  employerOrgId: string;
  name: string;
  verificationStatus: string;
  openJobs: number;
  activeApplications: number;
  recentActivityAt: string | null;
  overdueApprovals: number;
  stalledVacancies: number;
  repeatPlacements: number;
};

export type EmployerHealthSummary = {
  activeEmployers: number;
  openJobs: number;
  overdueApprovals: number;
  stalledVacancies: number;
  repeatPlacementEmployers: number;
  rows: EmployerHealthRow[];
};

/**
 * Employer health for the caller's scoped orgs (RLS). Does not accept a
 * foreign franchise id — callers must not pass one; filters are local only.
 */
export async function getFranchiseEmployerHealth(
  window: DateWindow,
  sort: FranchiseSortMode = "alpha_asc",
): Promise<EmployerHealthSummary> {
  const supabase = createClient();
  const [
    { data: employers },
    { data: jobs },
    { data: apps },
    { data: placements },
    { data: eapps },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("id,name,verification_status,updated_at")
      .eq("org_type", "employer")
      .order("name"),
    supabase.from("job_orders").select("id,employer_org_id,status,updated_at"),
    supabase.from("applications").select("id,job_order_id,current_stage,withdrawn_at,updated_at"),
    supabase.from("placements").select("id,employer_org_id,created_at,status"),
    supabase
      .from("employer_applications")
      .select("id,status,sla_due_at")
      .in("status", ["submitted", "under_review"]),
  ]);

  const employerRows =
    (employers as
      Pick<OrganizationRow, "id" | "name" | "verification_status" | "updated_at">[] | null) ?? [];
  const jobRows =
    (jobs as
      { id: string; employer_org_id: string; status: string; updated_at: string }[] | null) ?? [];
  const appRows =
    (apps as
      | {
          id: string;
          job_order_id: string;
          current_stage: string;
          withdrawn_at: string | null;
          updated_at: string;
        }[]
      | null) ?? [];
  const placementRows =
    (placements as
      { id: string; employer_org_id: string; created_at: string; status: string }[] | null) ?? [];
  const eappRows =
    (eapps as { id: string; status: string; sla_due_at: string | null }[] | null) ?? [];

  const openJobStatuses = new Set(["active", "approved", "on_hold", "submitted"]);
  const stalledJobStatuses = new Set(["on_hold"]);
  const terminalApp = new Set(["rejected", "hired", "closed", "invoiced"]);
  const since = window.since;

  const rows: EmployerHealthRow[] = employerRows.map((emp) => {
    const empJobs = jobRows.filter((j) => j.employer_org_id === emp.id);
    const openJobs = empJobs.filter((j) => openJobStatuses.has(j.status)).length;
    const stalledVacancies = empJobs.filter((j) => stalledJobStatuses.has(j.status)).length;
    const empJobIds = new Set(empJobs.map((j) => j.id));
    const activeApplications = appRows.filter(
      (a) => empJobIds.has(a.job_order_id) && !a.withdrawn_at && !terminalApp.has(a.current_stage),
    ).length;
    const empPlacements = placementRows.filter(
      (p) => p.employer_org_id === emp.id && p.status !== "failed",
    );
    const repeatPlacements = empPlacements.length >= 2 ? empPlacements.length : 0;
    const employerOverdueApprovals = empJobs.filter((j) => j.status === "submitted").length;

    const activityCandidates = [
      emp.updated_at,
      ...empJobs.map((j) => j.updated_at),
      ...appRows.filter((a) => empJobIds.has(a.job_order_id)).map((a) => a.updated_at),
      ...empPlacements.map((p) => p.created_at),
    ].filter((iso): iso is string => Boolean(iso) && iso >= since);
    activityCandidates.sort();
    const recentActivityAt = activityCandidates.length
      ? activityCandidates[activityCandidates.length - 1]!
      : null;

    return {
      employerOrgId: emp.id,
      name: emp.name,
      verificationStatus: emp.verification_status,
      openJobs,
      activeApplications,
      recentActivityAt,
      overdueApprovals: employerOverdueApprovals,
      stalledVacancies,
      repeatPlacements,
    };
  });

  const queueOverdue = eappRows.filter((e) => isSlaOverdue(e.sla_due_at, e.status)).length;

  let sorted = rows;
  if (sort === "alpha_desc") sorted = sortByNameDesc(rows);
  else if (sort === "alpha_asc" || sort === "newest" || sort === "oldest" || sort === "sla_first") {
    sorted = sortByNameAsc(rows);
  }

  return {
    activeEmployers: rows.filter((r) => r.openJobs > 0 || r.activeApplications > 0).length,
    openJobs: rows.reduce((n, r) => n + r.openJobs, 0),
    overdueApprovals: queueOverdue + rows.reduce((n, r) => n + r.overdueApprovals, 0),
    stalledVacancies: rows.reduce((n, r) => n + r.stalledVacancies, 0),
    repeatPlacementEmployers: rows.filter((r) => r.repeatPlacements > 0).length,
    rows: sorted,
  };
}

function sortByNameAsc(rows: EmployerHealthRow[]) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
function sortByNameDesc(rows: EmployerHealthRow[]) {
  return [...rows].sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }));
}

export type FranchiseCapacityRow = {
  recruiterId: string;
  name: string;
  email: string;
  level: string;
  activeWorkload: number;
  maxActiveWorkload: number;
  capacityRemaining: number;
  overCapacity: boolean;
  byStage: Record<string, number>;
  assignedJobs: number;
  slaOverdue: number;
};

export type FranchiseCapacityMatrix = {
  rows: FranchiseCapacityRow[];
  totalWorkload: number;
  totalCapacity: number;
};

/**
 * Capacity matrix built from existing franchise KPI comparison rows + targets.
 * Does not modify KPI definitions — imports getFranchiseKpiDashboard / listKpiTargets.
 */
export async function getFranchiseCapacityMatrix(
  franchiseOrgId: string,
  period: import("@/lib/kpi/definitions").KpiPeriod = "30d",
): Promise<FranchiseCapacityMatrix> {
  const { getFranchiseKpiDashboard, listKpiTargets } = await import("@/lib/data/recruiter-kpis");
  const [dash, orgTargets, platformTargets] = await Promise.all([
    getFranchiseKpiDashboard(franchiseOrgId, period),
    listKpiTargets(franchiseOrgId),
    listKpiTargets(null),
  ]);

  const targetForLevel = (level: string) => {
    const org = orgTargets.find((t) => t.recruiter_level === level);
    if (org) return org.max_active_workload;
    const plat = platformTargets.find((t) => t.recruiter_level === level);
    return plat?.max_active_workload ?? 40;
  };

  const rows: FranchiseCapacityRow[] = dash.recruiters.map((r) => {
    const max = targetForLevel(r.level);
    const remaining = max - r.activeWorkload;
    return {
      recruiterId: r.recruiterId,
      name: r.name,
      email: r.email,
      level: r.level,
      activeWorkload: r.activeWorkload,
      maxActiveWorkload: max,
      capacityRemaining: remaining,
      overCapacity: remaining < 0,
      byStage: {},
      assignedJobs: r.assignedJobs,
      slaOverdue: r.slaOverdue,
    };
  });

  // Optional stage breakdown via computeActiveWorkload on RLS-scoped apps.
  const supabase = createClient();
  const recruiterIds = rows.map((r) => r.recruiterId);
  if (recruiterIds.length > 0) {
    const { data: apps } = await supabase
      .from("applications")
      .select(
        "id,assigned_recruiter_id,current_stage,withdrawn_at,job_order_id,created_at,owning_org_id",
      )
      .in("assigned_recruiter_id", recruiterIds);
    const { computeActiveWorkload } = await import("@/lib/kpi/definitions");
    const snaps = (
      (apps as
        | {
            id: string;
            assigned_recruiter_id: string | null;
            current_stage: string;
            withdrawn_at: string | null;
            job_order_id: string;
            created_at: string;
            owning_org_id: string | null;
          }[]
        | null) ?? []
    ).map((a) => ({
      id: a.id,
      assignedRecruiterId: a.assigned_recruiter_id,
      currentStage: a.current_stage,
      createdAt: a.created_at,
      withdrawnAt: a.withdrawn_at,
      rejectedAt: null,
      rejectedFromStage: null,
      rejectionReason: null,
      jobOrderId: a.job_order_id,
      owningOrgId: a.owning_org_id ?? franchiseOrgId,
    }));
    for (const row of rows) {
      const wl = computeActiveWorkload(snaps, row.recruiterId);
      row.byStage = wl.byStage;
      row.activeWorkload = wl.total;
      row.capacityRemaining = row.maxActiveWorkload - wl.total;
      row.overCapacity = row.capacityRemaining < 0;
    }
  }

  rows.sort((a, b) => {
    if (a.overCapacity !== b.overCapacity) return a.overCapacity ? -1 : 1;
    return a.capacityRemaining - b.capacityRemaining;
  });

  return {
    rows,
    totalWorkload: rows.reduce((n, r) => n + r.activeWorkload, 0),
    totalCapacity: rows.reduce((n, r) => n + r.maxActiveWorkload, 0),
  };
}

export type FranchiseTargetHistoryEntry = {
  id: number;
  action: string;
  actorName: string;
  createdAt: string;
  beforeValue: unknown;
  afterValue: unknown;
  level: string | null;
};

export async function listFranchiseKpiTargetHistory(
  franchiseOrgId: string,
  limit = 50,
): Promise<FranchiseTargetHistoryEntry[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("org_context_id", franchiseOrgId)
    .like("action", "kpi_target%")
    .order("created_at", { ascending: false })
    .limit(limit);

  type Audit = {
    id: number;
    action: string;
    actor_id: string | null;
    created_at: string;
    before_value: unknown;
    after_value: unknown;
  };
  const logs = (data as Audit[] | null) ?? [];
  const actorIds = [...new Set(logs.map((l) => l.actor_id).filter(Boolean))] as string[];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id,full_name,email").in("id", actorIds)
    : { data: [] };
  const names = new Map(
    ((profiles as Pick<ProfileRow, "id" | "full_name" | "email">[] | null) ?? []).map((p) => [
      p.id,
      p.full_name || p.email,
    ]),
  );

  return logs.map((log) => {
    const after =
      log.after_value && typeof log.after_value === "object"
        ? (log.after_value as Record<string, unknown>)
        : {};
    return {
      id: log.id,
      action: log.action,
      actorName: log.actor_id ? (names.get(log.actor_id) ?? "Staff") : "System",
      createdAt: log.created_at,
      beforeValue: log.before_value,
      afterValue: log.after_value,
      level: typeof after.recruiter_level === "string" ? after.recruiter_level : null,
    };
  });
}

export async function isFranchiseFinanceAttributionEnabled(): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("feature_flags")
    .select("is_enabled")
    .eq("key", FRANCHISE_FINANCE_ATTRIBUTION_FLAG)
    .maybeSingle();
  return Boolean((data as { is_enabled: boolean } | null)?.is_enabled);
}

/**
 * Isolation helper used by tests: ensure a filter object never carries a
 * foreign franchiseOrgId into franchise loaders (loaders ignore it by design).
 */
export function assertNoCrossFranchiseFilter(input: Record<string, unknown>): void {
  if ("franchiseOrgId" in input || "foreignOrgId" in input || "otherFranchiseId" in input) {
    throw new Error("Cross-franchise filter keys are not accepted by franchise loaders");
  }
}
