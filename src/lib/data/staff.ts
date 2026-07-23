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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function collectUuid(value: unknown, into: Set<string>) {
  if (typeof value === "string" && value.length >= 32) into.add(value);
}

export interface HqAuditLogView extends AuditLogRow {
  actor_name: string;
  org_name: string | null;
  entity_label: string;
  detail: string | null;
}

/** HQ audit feed with resolved people, companies, jobs, and candidates. */
export async function getHqAuditLog(limit = 100): Promise<HqAuditLogView[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  const logs = (data as AuditLogRow[] | null) ?? [];
  if (logs.length === 0) return [];

  const actorIds = new Set<string>();
  const orgIds = new Set<string>();
  const jobOrderIds = new Set<string>();
  const applicationIds = new Set<string>();
  const assessmentIds = new Set<string>();
  const submissionIds = new Set<string>();
  const relatedProfileIds = new Set<string>();

  for (const log of logs) {
    if (log.actor_id) actorIds.add(log.actor_id);
    if (log.org_context_id) orgIds.add(log.org_context_id);
    const meta = asRecord(log.metadata);
    const after = asRecord(log.after_value);
    const before = asRecord(log.before_value);
    collectUuid(meta.employer_org_id, orgIds);
    collectUuid(meta.recruiter_user_id, relatedProfileIds);
    collectUuid(after.recruiter_user_id, relatedProfileIds);
    collectUuid(before.recruiter_user_id, relatedProfileIds);
    collectUuid(meta.application_id, applicationIds);
    collectUuid(meta.job_order_id, jobOrderIds);
    collectUuid(meta.candidate_id, relatedProfileIds);

    switch (log.entity_type) {
      case "job_order":
        if (log.entity_id) jobOrderIds.add(log.entity_id);
        break;
      case "application":
        if (log.entity_id) applicationIds.add(log.entity_id);
        break;
      case "assessment_assignment":
        if (log.entity_id) assessmentIds.add(log.entity_id);
        break;
      case "submission":
      case "employer_submission":
        if (log.entity_id) submissionIds.add(log.entity_id);
        break;
      default:
        break;
    }
  }

  const profileLookupIds = [...new Set([...actorIds, ...relatedProfileIds])];
  const [profilesRes, orgsRes, jobsRes, appsRes, assessmentsRes, submissionsRes] =
    await Promise.all([
      profileLookupIds.length
        ? supabase.from("profiles").select("id,full_name,email").in("id", profileLookupIds)
        : Promise.resolve({ data: [] }),
      orgIds.size
        ? supabase
            .from("organizations")
            .select("id,name,org_type")
            .in("id", [...orgIds])
        : Promise.resolve({ data: [] }),
      jobOrderIds.size
        ? supabase
            .from("job_orders")
            .select("id,title,employer_org_id,responsible_org_id")
            .in("id", [...jobOrderIds])
        : Promise.resolve({ data: [] }),
      applicationIds.size
        ? supabase
            .from("applications")
            .select("id,candidate_id,job_order_id,assigned_recruiter_id")
            .in("id", [...applicationIds])
        : Promise.resolve({ data: [] }),
      assessmentIds.size
        ? supabase
            .from("assessment_assignments")
            .select("id,candidate_id,job_order_id,assigned_by")
            .in("id", [...assessmentIds])
        : Promise.resolve({ data: [] }),
      submissionIds.size
        ? supabase
            .from("employer_submissions")
            .select("id,candidate_id,job_order_id,employer_org_id,submitting_recruiter_id")
            .in("id", [...submissionIds])
        : Promise.resolve({ data: [] }),
    ]);

  const jobs =
    (jobsRes.data as
      | {
          id: string;
          title: string;
          employer_org_id: string;
          responsible_org_id: string;
        }[]
      | null) ?? [];
  for (const job of jobs) {
    orgIds.add(job.employer_org_id);
    orgIds.add(job.responsible_org_id);
  }

  const apps =
    (appsRes.data as
      | {
          id: string;
          candidate_id: string;
          job_order_id: string;
          assigned_recruiter_id: string | null;
        }[]
      | null) ?? [];
  const assessments =
    (assessmentsRes.data as
      { id: string; candidate_id: string; job_order_id: string; assigned_by: string }[] | null) ??
    [];
  const submissions =
    (submissionsRes.data as
      | {
          id: string;
          candidate_id: string;
          job_order_id: string;
          employer_org_id: string;
          submitting_recruiter_id: string | null;
        }[]
      | null) ?? [];

  const missingJobIds = new Set<string>();
  const candidateIds = new Set<string>();
  for (const app of apps) {
    candidateIds.add(app.candidate_id);
    if (!jobs.some((job) => job.id === app.job_order_id)) missingJobIds.add(app.job_order_id);
    if (app.assigned_recruiter_id) relatedProfileIds.add(app.assigned_recruiter_id);
  }
  for (const row of assessments) {
    candidateIds.add(row.candidate_id);
    if (!jobs.some((job) => job.id === row.job_order_id)) missingJobIds.add(row.job_order_id);
  }
  for (const row of submissions) {
    candidateIds.add(row.candidate_id);
    orgIds.add(row.employer_org_id);
    if (!jobs.some((job) => job.id === row.job_order_id)) missingJobIds.add(row.job_order_id);
    if (row.submitting_recruiter_id) relatedProfileIds.add(row.submitting_recruiter_id);
  }

  const [extraJobsRes, candidatesRes] = await Promise.all([
    missingJobIds.size
      ? supabase
          .from("job_orders")
          .select("id,title,employer_org_id,responsible_org_id")
          .in("id", [...missingJobIds])
      : Promise.resolve({ data: [] }),
    candidateIds.size
      ? supabase
          .from("candidate_profiles")
          .select("id,given_name,family_name,user_id")
          .in("id", [...candidateIds])
      : Promise.resolve({ data: [] }),
  ]);

  const allJobs = [...jobs, ...((extraJobsRes.data as typeof jobs | null) ?? [])];
  for (const job of allJobs) {
    orgIds.add(job.employer_org_id);
    orgIds.add(job.responsible_org_id);
  }

  const [extraOrgsRes, extraProfilesRes] = await Promise.all([
    orgIds.size
      ? supabase
          .from("organizations")
          .select("id,name,org_type")
          .in("id", [...orgIds])
      : Promise.resolve({ data: orgsRes.data }),
    [...new Set([...profileLookupIds, ...relatedProfileIds])].length
      ? supabase
          .from("profiles")
          .select("id,full_name,email")
          .in("id", [...new Set([...profileLookupIds, ...relatedProfileIds])])
      : Promise.resolve({ data: profilesRes.data }),
  ]);

  const orgName = new Map(
    (
      (extraOrgsRes.data as { id: string; name: string; org_type: string }[] | null) ??
      (orgsRes.data as { id: string; name: string; org_type: string }[] | null) ??
      []
    ).map((org) => [org.id, org.name]),
  );
  const profileName = new Map(
    (
      (extraProfilesRes.data as { id: string; full_name: string | null; email: string }[] | null) ??
      (profilesRes.data as { id: string; full_name: string | null; email: string }[] | null) ??
      []
    ).map((profile) => [profile.id, profile.full_name?.trim() || profile.email]),
  );
  const jobById = new Map(allJobs.map((job) => [job.id, job]));
  const candidateName = new Map(
    (
      (candidatesRes.data as
        | {
            id: string;
            given_name: string | null;
            family_name: string | null;
            user_id: string;
          }[]
        | null) ?? []
    ).map((candidate) => {
      const name = `${candidate.given_name ?? ""} ${candidate.family_name ?? ""}`.trim();
      return [candidate.id, name || profileName.get(candidate.user_id) || "Candidate"];
    }),
  );
  const appById = new Map(apps.map((app) => [app.id, app]));
  const assessmentById = new Map(assessments.map((row) => [row.id, row]));
  const submissionById = new Map(submissions.map((row) => [row.id, row]));

  function jobLabel(jobId: string | null | undefined): string | null {
    if (!jobId) return null;
    const job = jobById.get(jobId);
    if (!job) return null;
    const employer = orgName.get(job.employer_org_id);
    return employer ? `${job.title} · ${employer}` : job.title;
  }

  return logs.map((log) => {
    const meta = asRecord(log.metadata);
    const after = asRecord(log.after_value);
    const before = asRecord(log.before_value);
    const actor_name = log.actor_id ? profileName.get(log.actor_id) || "Unknown user" : "System";
    const org_name = log.org_context_id ? (orgName.get(log.org_context_id) ?? null) : null;

    let entity_label = titleCaseEntity(log.entity_type);
    let detail: string | null = null;

    if (log.entity_type === "job_order" && log.entity_id) {
      entity_label = jobLabel(log.entity_id) ?? `Job order ${log.entity_id.slice(0, 8)}`;
      const recruiterId =
        (typeof after.recruiter_user_id === "string" && after.recruiter_user_id) ||
        (typeof meta.recruiter_user_id === "string" && meta.recruiter_user_id) ||
        null;
      if (recruiterId) {
        detail = `Recruiter: ${profileName.get(recruiterId) || recruiterId.slice(0, 8)}`;
        const prev = typeof before.recruiter_user_id === "string" ? before.recruiter_user_id : null;
        if (prev && profileName.get(prev)) {
          detail += ` (was ${profileName.get(prev)})`;
        }
      }
      if (typeof after.denial_reason === "string" && after.denial_reason) {
        detail = `Reason: ${after.denial_reason}`;
      }
    } else if (log.entity_type === "application" && log.entity_id) {
      const app = appById.get(log.entity_id);
      if (app) {
        const candidate = candidateName.get(app.candidate_id) ?? "Candidate";
        const job = jobLabel(app.job_order_id);
        entity_label = job ? `${candidate} · ${job}` : candidate;
        if (app.assigned_recruiter_id) {
          detail = `Owner: ${profileName.get(app.assigned_recruiter_id) || "Unassigned"}`;
        }
      } else {
        entity_label = `Application ${log.entity_id.slice(0, 8)}`;
      }
      if (typeof after.to_stage === "string" || typeof after.stage === "string") {
        const stage = String(after.to_stage ?? after.stage);
        detail = detail
          ? `${detail} · Stage → ${titleCaseWords(stage)}`
          : `Stage → ${titleCaseWords(stage)}`;
      }
    } else if (log.entity_type === "assessment_assignment" && log.entity_id) {
      const row = assessmentById.get(log.entity_id);
      if (row) {
        const candidate = candidateName.get(row.candidate_id) ?? "Candidate";
        const job = jobLabel(row.job_order_id);
        entity_label = job ? `${candidate} · ${job}` : candidate;
      } else {
        entity_label = `Assessment ${log.entity_id.slice(0, 8)}`;
      }
    } else if (
      (log.entity_type === "submission" || log.entity_type === "employer_submission") &&
      log.entity_id
    ) {
      const row = submissionById.get(log.entity_id);
      if (row) {
        const candidate = candidateName.get(row.candidate_id) ?? "Candidate";
        const employer = orgName.get(row.employer_org_id);
        const job = jobLabel(row.job_order_id);
        entity_label = [candidate, job, employer].filter(Boolean).join(" · ");
        if (row.submitting_recruiter_id) {
          detail = `Submitted by ${profileName.get(row.submitting_recruiter_id) || "recruiter"}`;
        }
      } else {
        entity_label = `Submission ${log.entity_id.slice(0, 8)}`;
      }
    } else if (log.entity_id) {
      entity_label = `${titleCaseEntity(log.entity_type)} ${log.entity_id.slice(0, 8)}`;
    }

    return {
      ...log,
      actor_name,
      org_name,
      entity_label,
      detail,
    };
  });
}

function titleCaseEntity(value: string): string {
  return value
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleCaseWords(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
