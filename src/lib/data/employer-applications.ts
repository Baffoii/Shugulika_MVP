import { createClient } from "@/lib/supabase/server";
import type {
  EmployerApplicationRow,
  EmployerApplicationEventRow,
  EligibleFranchiseRow,
  OrganizationRow,
  ProfileRow,
} from "@/lib/database.types";

/** Latest onboarding application for the signed-in employer user. */
export async function getMyEmployerApplication(
  userId: string,
): Promise<EmployerApplicationRow | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("employer_applications")
    .select("*")
    .eq("applicant_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as EmployerApplicationRow | null) ?? null;
}

/** Timeline events. RLS hides reviewer-only rows from the applicant. */
export async function getEmployerApplicationEvents(
  applicationId: string,
): Promise<EmployerApplicationEventRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("employer_application_events")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  return (data as EmployerApplicationEventRow[] | null) ?? [];
}

/** Active franchises eligible for a geography (drives the routing step). */
export async function getEligibleFranchises(
  country: string,
  region?: string | null,
): Promise<EligibleFranchiseRow[]> {
  if (!country) return [];
  const supabase = createClient();
  const { data } = await supabase.rpc("eligible_employer_franchises", {
    p_country: country,
    p_region: region ?? null,
  });
  return (data as EligibleFranchiseRow[] | null) ?? [];
}

/** Name of the responsible office shown on the applicant's status screen. */
export async function getOrganizationName(orgId: string | null): Promise<string | null> {
  if (!orgId) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

export interface EmployerApplicationListItem extends EmployerApplicationRow {
  applicant_name: string;
  applicant_email: string;
  assigned_org_name: string;
  owner_user_id?: string | null;
  owner_name?: string | null;
  sla_due_at?: string | null;
  next_action?: string | null;
  age_hours?: number | null;
  sla_overdue?: boolean;
}

export interface EmployerApplicationFilters {
  status?: string;
  country?: string;
  ownerUserId?: string;
  nextAction?: string;
  slaOnly?: boolean;
  /** alpha_asc | alpha_desc | newest | oldest | sla_first */
  sort?: string;
}

/**
 * Review queue. Rows are already authorization-scoped by RLS before any
 * filtering happens here (HQ = global; franchise = assigned + in-region only).
 */
export async function listEmployerApplicationsForReview(
  filters: EmployerApplicationFilters = {},
): Promise<EmployerApplicationListItem[]> {
  const supabase = createClient();
  let query = supabase
    .from("employer_applications")
    .select("*")
    .neq("status", "draft")
    .order("submitted_at", { ascending: false, nullsFirst: false });
  if (filters.status)
    query = query.eq("status", filters.status as NonNullable<EmployerApplicationRow["status"]>);
  if (filters.country) query = query.eq("country_code", filters.country);
  // Additive ops columns (migration 20260806*) are not yet in frozen database.types.ts.
  const opsQuery = query as unknown as {
    eq: (col: string, val: string) => typeof query;
    is: (col: string, val: null) => typeof query;
  };
  if (filters.ownerUserId === "unassigned") query = opsQuery.is("owner_user_id", null);
  else if (filters.ownerUserId) query = opsQuery.eq("owner_user_id", filters.ownerUserId);
  if (filters.nextAction) query = opsQuery.eq("next_action", filters.nextAction);
  const { data } = await query;
  const rows = (data as EmployerApplicationRow[] | null) ?? [];
  let enriched = await enrichApplications(rows);
  if (filters.slaOnly) {
    enriched = enriched.filter((r) => r.sla_overdue);
  }
  return sortEmployerApplicationList(enriched, filters.sort);
}

function sortEmployerApplicationList(
  rows: EmployerApplicationListItem[],
  sort?: string,
): EmployerApplicationListItem[] {
  const copy = [...rows];
  switch (sort) {
    case "alpha_asc":
      copy.sort((a, b) =>
        (a.legal_name ?? "").localeCompare(b.legal_name ?? "", undefined, { sensitivity: "base" }),
      );
      break;
    case "alpha_desc":
      copy.sort((a, b) =>
        (b.legal_name ?? "").localeCompare(a.legal_name ?? "", undefined, { sensitivity: "base" }),
      );
      break;
    case "oldest":
      copy.sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
      break;
    case "newest":
      copy.sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));
      break;
    case "sla_first":
      copy.sort((a, b) => {
        if (Boolean(a.sla_overdue) !== Boolean(b.sla_overdue)) return a.sla_overdue ? -1 : 1;
        return (a.sla_due_at ?? "9999").localeCompare(b.sla_due_at ?? "9999");
      });
      break;
    default:
      break;
  }
  return copy;
}

export interface EmployerApplicationDetail {
  application: EmployerApplicationListItem;
  events: EmployerApplicationEventRow[];
  /** For the HQ assign/reassign control. */
  eligibleFranchises: EligibleFranchiseRow[];
}

export async function getEmployerApplicationForReview(
  applicationId: string,
): Promise<EmployerApplicationDetail | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("employer_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  const application = data as EmployerApplicationRow | null;
  if (!application) return null;

  const [enriched, events, eligibleFranchises] = await Promise.all([
    enrichApplications([application]),
    getEmployerApplicationEvents(applicationId),
    application.country_code
      ? getEligibleFranchises(application.country_code, application.region)
      : Promise.resolve([]),
  ]);
  const first = enriched[0];
  if (!first) return null;
  return { application: first, events, eligibleFranchises };
}

async function enrichApplications(
  rows: EmployerApplicationRow[],
): Promise<EmployerApplicationListItem[]> {
  if (rows.length === 0) return [];
  const supabase = createClient();
  const opsOf = (row: EmployerApplicationRow) => {
    const r = row as EmployerApplicationRow & {
      owner_user_id?: string | null;
      sla_due_at?: string | null;
      next_action?: string | null;
    };
    return {
      owner_user_id: r.owner_user_id ?? null,
      sla_due_at: r.sla_due_at ?? null,
      next_action: r.next_action ?? null,
    };
  };
  const userIds = [
    ...new Set([
      ...rows.map((r) => r.applicant_user_id),
      ...rows.map((r) => opsOf(r).owner_user_id).filter((v): v is string => !!v),
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
  const { applicationAgeHours, isSlaOverdue } = await import("@/lib/franchise/employer-app-ops");
  return rows.map((row) => {
    const ops = opsOf(row);
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
