"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { memberOrgIds, requirePortal, requireSession } from "@/lib/auth";
import { jobOrderSchema } from "@/lib/validation";
import type { OrganizationRow } from "@/lib/database.types";

export interface JobOrderActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

function optionalText(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

export async function submitJobOrderAction(
  _previous: JobOrderActionResult,
  formData: FormData,
): Promise<JobOrderActionResult> {
  const ctx = await requirePortal("employer");
  const employerMembership = ctx.memberships.find(
    (m) => m.status === "active" && m.role === "employer_user" && m.organization_id,
  );
  if (!employerMembership?.organization_id) {
    return { ok: false, error: "Your account is not linked to an employer organization." };
  }

  const parsed = jobOrderSchema.safeParse({
    title: formData.get("title"),
    department: optionalText(formData, "department"),
    description: optionalText(formData, "description"),
    requirements: optionalText(formData, "requirements"),
    country_code: formData.get("country_code"),
    city: optionalText(formData, "city"),
    employment_type: optionalText(formData, "employment_type"),
    work_arrangement: optionalText(formData, "work_arrangement"),
    experience_level: optionalText(formData, "experience_level"),
    vacancy_count: formData.get("vacancy_count"),
    recruitment_path: formData.get("recruitment_path"),
    salary_min: optionalText(formData, "salary_min"),
    salary_max: optionalText(formData, "salary_max"),
    salary_public: formData.get("salary_public") === "on",
    application_deadline: optionalText(formData, "application_deadline"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the job details." };
  }

  const supabase = createClient();
  const { data: employerData } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", employerMembership.organization_id)
    .maybeSingle();
  const employer = employerData as OrganizationRow | null;
  if (!employer?.parent_id) {
    return { ok: false, error: "Your company is not assigned to a Shugulika franchise." };
  }

  const values = parsed.data;
  if (
    values.salary_min != null &&
    values.salary_max != null &&
    values.salary_max < values.salary_min
  ) {
    return { ok: false, error: "Maximum salary must be greater than minimum salary." };
  }

  const { error } = await supabase.from("job_orders").insert({
    employer_org_id: employer.id,
    responsible_org_id: employer.parent_id,
    created_by: ctx.userId,
    status: "submitted",
    ...values,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/employer/job-orders");
  revalidatePath("/hq/jobs");
  revalidatePath("/franchise/jobs");
  revalidatePath("/recruiter/jobs");
  return { ok: true, message: "Job order submitted to Shugulika for approval." };
}

export async function withdrawJobOrderAction(
  jobOrderId: string,
): Promise<JobOrderActionResult> {
  await requirePortal("employer");

  const supabase = createClient();
  const { error } = await supabase.rpc("withdraw_job_order", {
    p_job_order_id: jobOrderId,
  });
  if (error) return { ok: false, error: error.message };

  for (const path of [
    "/jobs",
    "/hq/jobs",
    "/franchise/jobs",
    "/recruiter/jobs",
    "/employer/job-orders",
    "/hq/audit-log",
  ]) {
    revalidatePath(path);
  }
  return { ok: true, message: "Job order withdrawn." };
}

export async function approveAndPublishJobOrderAction(
  jobOrderId: string,
): Promise<JobOrderActionResult> {
  const ctx = await requireSession();
  const canPublish = ctx.roles.some((role) =>
    ["hq_admin", "franchise_admin", "recruiter"].includes(role),
  );
  if (!canPublish) return { ok: false, error: "You do not have permission to publish jobs." };

  const supabase = createClient();
  const { data: order } = await supabase
    .from("job_orders")
    .select("id,responsible_org_id,status")
    .eq("id", jobOrderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "Job order not found or not authorized." };
  if (order.status !== "submitted") {
    return { ok: false, error: "Only submitted job orders can be approved and published." };
  }
  if (
    !ctx.roles.includes("hq_admin") &&
    !memberOrgIds(ctx.memberships).includes(order.responsible_org_id)
  ) {
    return { ok: false, error: "This job order is outside your organization scope." };
  }

  const { error } = await supabase.rpc("approve_and_publish_job_order", {
    p_job_order_id: jobOrderId,
  });
  if (error) return { ok: false, error: error.message };

  for (const path of [
    "/jobs",
    "/hq/jobs",
    "/franchise/jobs",
    "/recruiter/jobs",
    "/employer/job-orders",
    "/hq/audit-log",
  ]) {
    revalidatePath(path);
  }
  return { ok: true, message: "Job approved and published." };
}

export async function assignJobOrderRecruiterAction(
  jobOrderId: string,
  recruiterUserId: string,
): Promise<JobOrderActionResult> {
  const ctx = await requireSession();
  const canAssign = ctx.roles.some((role) =>
    ["hq_admin", "franchise_admin", "operations"].includes(role),
  );
  if (!canAssign) {
    return { ok: false, error: "You do not have permission to assign recruiters." };
  }
  if (!jobOrderId || !recruiterUserId) {
    return { ok: false, error: "Choose a recruiter to assign." };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("assign_job_order_recruiter", {
    p_job_order_id: jobOrderId,
    p_recruiter_user_id: recruiterUserId,
  });
  if (error) return { ok: false, error: error.message };

  for (const path of [
    "/hq/jobs",
    "/franchise/jobs",
    "/recruiter/jobs",
    "/hq/recruiters",
    "/franchise/recruiters",
    "/recruiter/notifications",
    "/hq/audit-log",
  ]) {
    revalidatePath(path);
  }
  return { ok: true, message: "Recruiter assigned." };
}
