import { createClient } from "@/lib/supabase/server";
import type {
  EmployerSubmissionRow,
  JobOrderRow,
  InvoiceRow,
  PlacementRow,
  OrganizationRow,
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
