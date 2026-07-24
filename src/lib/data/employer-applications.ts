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
}

export interface EmployerApplicationFilters {
  status?: string;
  country?: string;
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
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.country) query = query.eq("country_code", filters.country);
  const { data } = await query;
  const rows = (data as EmployerApplicationRow[] | null) ?? [];
  return enrichApplications(rows);
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
  const userIds = [...new Set(rows.map((r) => r.applicant_user_id))];
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
  return rows.map((row) => ({
    ...row,
    applicant_name: profileById.get(row.applicant_user_id)?.full_name ?? "—",
    applicant_email: profileById.get(row.applicant_user_id)?.email ?? "",
    assigned_org_name: row.assigned_org_id
      ? (orgById.get(row.assigned_org_id) ?? "Assigned office")
      : "Shugulika HQ",
  }));
}
