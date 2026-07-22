import { createClient } from "@/lib/supabase/server";
import type {
  EmployerSubmissionRow,
  JobOrderRow,
  InvoiceRow,
  PlacementRow,
  OrganizationRow,
  AuditLogRow,
  ProfileRow,
} from "@/lib/database.types";

/** Counts are RLS-scoped: each role sees only its authorized rows. */
export interface StaffMetrics {
  activeJobs: number;
  applications: number;
  submissions: number;
  interviews: number;
  offers: number;
  placements: number;
  openInvoices: number;
}

export async function getStaffMetrics(): Promise<StaffMetrics> {
  const supabase = createClient();
  const [jobs, apps, subs, interviews, offers, placements, invoices] = await Promise.all([
    supabase.from("job_orders").select("status"),
    supabase.from("applications").select("id", { count: "exact", head: true }),
    supabase.from("employer_submissions").select("id", { count: "exact", head: true }),
    supabase.from("interviews").select("id", { count: "exact", head: true }),
    supabase.from("offers").select("id", { count: "exact", head: true }),
    supabase.from("placements").select("id", { count: "exact", head: true }),
    supabase.from("invoices").select("payment_status"),
  ]);
  const jobRows = (jobs.data ?? []) as { status: string }[];
  const invRows = (invoices.data ?? []) as { payment_status: string }[];
  return {
    activeJobs: jobRows.filter((j) => ["active", "approved", "on_hold"].includes(j.status)).length,
    applications: apps.count ?? 0,
    submissions: subs.count ?? 0,
    interviews: interviews.count ?? 0,
    offers: offers.count ?? 0,
    placements: placements.count ?? 0,
    openInvoices: invRows.filter((i) => i.payment_status !== "paid").length,
  };
}

export async function getJobOrders(): Promise<JobOrderRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("job_orders")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as JobOrderRow[] | null) ?? [];
}

export interface JobOrderAuditView extends AuditLogRow {
  actor_name: string;
}

export async function getJobOrderAudits(jobOrderIds: string[]): Promise<JobOrderAuditView[]> {
  if (jobOrderIds.length === 0) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("entity_type", "job_order")
    .in("entity_id", jobOrderIds)
    .order("created_at", { ascending: false });
  const logs = (data as AuditLogRow[] | null) ?? [];
  const actorIds = [...new Set(logs.map((log) => log.actor_id).filter(Boolean))] as string[];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("*").in("id", actorIds)
    : { data: [] };
  const names = new Map(
    ((profiles as ProfileRow[] | null) ?? []).map((profile) => [
      profile.id,
      profile.full_name || profile.email,
    ]),
  );
  return logs.map((log) => ({
    ...log,
    actor_name: log.actor_id ? names.get(log.actor_id) || log.actor_id.slice(0, 8) : "System",
  }));
}

export interface EmployerSubmissionView extends EmployerSubmissionRow {
  job_orders: Pick<JobOrderRow, "id" | "title"> | null;
}
export async function getEmployerSubmissions(): Promise<EmployerSubmissionView[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("employer_submissions")
    .select("*, job_orders(id,title)")
    .order("created_at", { ascending: false });
  return (data as EmployerSubmissionView[] | null) ?? [];
}

export async function getSubmissionDetail(id: string): Promise<EmployerSubmissionView | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("employer_submissions")
    .select("*, job_orders(id,title)")
    .eq("id", id)
    .maybeSingle();
  return (data as EmployerSubmissionView | null) ?? null;
}

export async function getInvoices(): Promise<InvoiceRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as InvoiceRow[] | null) ?? [];
}

export async function getPlacements(): Promise<PlacementRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("placements")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as PlacementRow[] | null) ?? [];
}

export async function getOrganizations(
  type?: "hq" | "franchise" | "employer",
): Promise<OrganizationRow[]> {
  const supabase = createClient();
  let q = supabase.from("organizations").select("*").order("name");
  if (type) q = q.eq("org_type", type);
  const { data } = await q;
  return (data as OrganizationRow[] | null) ?? [];
}

export interface JobOwnerAssignment {
  job_order_id: string;
  recruiter_user_id: string;
  recruiter_name: string;
}

export interface ScopedRecruiter {
  id: string;
  name: string;
  email: string;
  organization_id: string;
}

/** Owner assignments for the given job orders. */
export async function getJobOwnerAssignments(jobOrderIds: string[]): Promise<JobOwnerAssignment[]> {
  if (jobOrderIds.length === 0) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("job_assignments")
    .select("job_order_id,recruiter_user_id")
    .in("job_order_id", jobOrderIds)
    .eq("role", "owner");
  const rows = (data as { job_order_id: string; recruiter_user_id: string }[] | null) ?? [];
  if (rows.length === 0) return [];

  const recruiterIds = [...new Set(rows.map((row) => row.recruiter_user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,full_name,email")
    .in("id", recruiterIds);
  const names = new Map(
    ((profiles as ProfileRow[] | null) ?? []).map((profile) => [
      profile.id,
      profile.full_name || profile.email,
    ]),
  );
  return rows.map((row) => ({
    job_order_id: row.job_order_id,
    recruiter_user_id: row.recruiter_user_id,
    recruiter_name: names.get(row.recruiter_user_id) ?? row.recruiter_user_id.slice(0, 8),
  }));
}

/** Active recruiters in the given franchise org ids (RLS-scoped). */
export async function listRecruitersForOrgs(organizationIds: string[]): Promise<ScopedRecruiter[]> {
  if (organizationIds.length === 0) return [];
  const supabase = createClient();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("user_id,organization_id")
    .in("organization_id", organizationIds)
    .eq("role", "recruiter")
    .eq("status", "active");
  const mems = (memberships as { user_id: string; organization_id: string }[] | null) ?? [];
  if (mems.length === 0) return [];

  const userIds = [...new Set(mems.map((m) => m.user_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,full_name,email")
    .in("id", userIds)
    .order("full_name");
  const profileById = new Map(
    ((profiles as ProfileRow[] | null) ?? []).map((profile) => [profile.id, profile]),
  );

  const result: ScopedRecruiter[] = [];
  for (const mem of mems) {
    const profile = profileById.get(mem.user_id);
    if (!profile) continue;
    result.push({
      id: profile.id,
      name: profile.full_name || profile.email,
      email: profile.email,
      organization_id: mem.organization_id,
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** Open jobs owned by a recruiter via job_assignments.owner. */
export async function getJobsOwnedByRecruiter(recruiterId: string): Promise<JobOrderRow[]> {
  const supabase = createClient();
  const { data: assignments } = await supabase
    .from("job_assignments")
    .select("job_order_id")
    .eq("recruiter_user_id", recruiterId)
    .eq("role", "owner");
  const jobIds = ((assignments as { job_order_id: string }[] | null) ?? []).map(
    (row) => row.job_order_id,
  );
  if (jobIds.length === 0) return [];

  const { data } = await supabase
    .from("job_orders")
    .select("*")
    .in("id", jobIds)
    .order("created_at", { ascending: false });
  return (data as JobOrderRow[] | null) ?? [];
}

export interface OwnedJobAssignmentView {
  job_order_id: string;
  title: string;
  status: string;
  country_code: string;
  city: string | null;
  created_at: string;
  recruiter_user_id: string;
  recruiter_name: string;
  recruiter_region: string | null;
}

/** All owner assignments in the current RLS scope, with job + recruiter region. */
export async function listOwnedJobAssignments(): Promise<OwnedJobAssignmentView[]> {
  const supabase = createClient();
  const { data: assignmentRows } = await supabase
    .from("job_assignments")
    .select("job_order_id,recruiter_user_id")
    .eq("role", "owner");
  const assignments =
    (assignmentRows as { job_order_id: string; recruiter_user_id: string }[] | null) ?? [];
  if (assignments.length === 0) return [];

  const jobIds = [...new Set(assignments.map((row) => row.job_order_id))];
  const recruiterIds = [...new Set(assignments.map((row) => row.recruiter_user_id))];

  const [{ data: jobs }, { data: profiles }, { data: memberships }] = await Promise.all([
    supabase.from("job_orders").select("*").in("id", jobIds),
    supabase.from("profiles").select("id,full_name,email").in("id", recruiterIds),
    supabase
      .from("memberships")
      .select("user_id,country_code")
      .in("user_id", recruiterIds)
      .eq("role", "recruiter")
      .eq("status", "active"),
  ]);

  const jobById = new Map(((jobs as JobOrderRow[] | null) ?? []).map((job) => [job.id, job]));
  const nameById = new Map(
    ((profiles as ProfileRow[] | null) ?? []).map((profile) => [
      profile.id,
      profile.full_name || profile.email,
    ]),
  );
  const regionById = new Map<string, string | null>();
  for (const mem of (memberships as { user_id: string; country_code: string | null }[] | null) ??
    []) {
    if (!regionById.has(mem.user_id)) regionById.set(mem.user_id, mem.country_code);
  }

  return assignments
    .map((row) => {
      const job = jobById.get(row.job_order_id);
      if (!job) return null;
      return {
        job_order_id: job.id,
        title: job.title,
        status: job.status,
        country_code: job.country_code,
        city: job.city,
        created_at: job.created_at,
        recruiter_user_id: row.recruiter_user_id,
        recruiter_name: nameById.get(row.recruiter_user_id) ?? row.recruiter_user_id.slice(0, 8),
        recruiter_region: regionById.get(row.recruiter_user_id) ?? null,
      } satisfies OwnedJobAssignmentView;
    })
    .filter((row): row is OwnedJobAssignmentView => row != null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
