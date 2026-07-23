"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { memberOrgIds, requirePortal, requireSession } from "@/lib/auth";
import { jobOrderSchema } from "@/lib/validation";
import type { OrganizationRow } from "@/lib/database.types";

const ASSESSMENT_BUCKET = "employer-assessments";
const MAX_ASSESSMENT_BYTES = 10 * 1024 * 1024;
const ASSESSMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "csv"]);

export interface JobOrderActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

function optionalText(formData: FormData, key: string): string | undefined {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

function collectFiles(formData: FormData, key: string): File[] {
  return formData
    .getAll(key)
    .filter((value): value is File => value instanceof File && value.size > 0);
}

function validateAssessmentFile(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ASSESSMENT_EXTENSIONS.has(extension)) {
    return "Use PDF, DOC, DOCX, XLS, XLSX, or CSV for assessment files.";
  }
  if (file.size > MAX_ASSESSMENT_BYTES) {
    return "Each assessment file must be 10 MB or smaller.";
  }
  return null;
}

async function uploadAssessmentFiles(opts: {
  supabase: ReturnType<typeof createClient>;
  employerOrgId: string;
  jobOrderId: string;
  kind: "candidate_test" | "answer_key";
  files: File[];
  uploadedBy: string;
}): Promise<{
  error?: string;
  first?: { path: string; name: string; mime: string | null; size: number };
}> {
  let first: { path: string; name: string; mime: string | null; size: number } | undefined;
  const uploadedPaths: string[] = [];
  for (const file of opts.files) {
    const invalid = validateAssessmentFile(file);
    if (invalid) {
      if (uploadedPaths.length) {
        await opts.supabase.storage.from(ASSESSMENT_BUCKET).remove(uploadedPaths);
      }
      return { error: invalid };
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${opts.employerOrgId}/${opts.jobOrderId}/${opts.kind}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await opts.supabase.storage
      .from(ASSESSMENT_BUCKET)
      .upload(path, file, { upsert: false });
    if (uploadError) {
      if (uploadedPaths.length) {
        await opts.supabase.storage.from(ASSESSMENT_BUCKET).remove(uploadedPaths);
      }
      return { error: uploadError.message };
    }
    uploadedPaths.push(path);
    const { error: metaError } = await opts.supabase.from("job_order_assessment_files").insert({
      job_order_id: opts.jobOrderId,
      kind: opts.kind,
      bucket_id: ASSESSMENT_BUCKET,
      object_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      byte_size: file.size,
      uploaded_by: opts.uploadedBy,
    });
    if (metaError) {
      await opts.supabase.storage.from(ASSESSMENT_BUCKET).remove(uploadedPaths);
      return { error: metaError.message };
    }
    if (!first) {
      first = {
        path,
        name: file.name,
        mime: file.type || null,
        size: file.size,
      };
    }
  }
  return { first };
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

  const assessmentMode = String(formData.get("assessment_mode") ?? "shugulika");
  if (!(["shugulika", "employer", "both"] as const).includes(assessmentMode as never)) {
    return { ok: false, error: "Choose who should administer the aptitude assessment." };
  }
  const assessmentSeniority = String(formData.get("assessment_seniority") ?? "junior");
  if (!(["junior", "senior"] as const).includes(assessmentSeniority as never)) {
    return { ok: false, error: "Choose a valid assessment seniority." };
  }

  const jobOrderId = crypto.randomUUID();
  const candidateTestFiles = [
    ...collectFiles(formData, "assessment_files"),
    ...collectFiles(formData, "assessment_file"),
  ];
  const answerKeyFiles = collectFiles(formData, "answer_key_files");

  let assessmentPath: string | null = null;
  let assessmentName: string | null = null;
  let assessmentMime: string | null = null;
  let assessmentSize: number | null = null;

  if (assessmentMode === "employer" || assessmentMode === "both") {
    if (candidateTestFiles.length === 0) {
      return {
        ok: false,
        error: "Attach at least one candidate-facing employer test file before submitting.",
      };
    }
    if (answerKeyFiles.length === 0) {
      return {
        ok: false,
        error: "Attach at least one answer-key file for the employer test before submitting.",
      };
    }
  }

  // Insert job order first so file rows can reference it.
  const { error } = await supabase.from("job_orders").insert({
    id: jobOrderId,
    employer_org_id: employer.id,
    responsible_org_id: employer.parent_id,
    created_by: ctx.userId,
    status: "submitted",
    assessment_mode: assessmentMode as "shugulika" | "employer" | "both",
    assessment_seniority: assessmentSeniority as "junior" | "senior",
    assessment_file_bucket: null,
    assessment_file_path: null,
    assessment_file_name: null,
    assessment_file_mime: null,
    assessment_file_size: null,
    ...values,
  });
  if (error) return { ok: false, error: error.message };

  if (assessmentMode === "employer" || assessmentMode === "both") {
    const candidateUpload = await uploadAssessmentFiles({
      supabase,
      employerOrgId: employer.id,
      jobOrderId,
      kind: "candidate_test",
      files: candidateTestFiles,
      uploadedBy: ctx.userId,
    });
    if (candidateUpload.error) {
      await supabase.rpc("withdraw_job_order", { p_job_order_id: jobOrderId });
      return { ok: false, error: candidateUpload.error };
    }
    const answerUpload = await uploadAssessmentFiles({
      supabase,
      employerOrgId: employer.id,
      jobOrderId,
      kind: "answer_key",
      files: answerKeyFiles,
      uploadedBy: ctx.userId,
    });
    if (answerUpload.error) {
      const { data: existingFiles } = await supabase
        .from("job_order_assessment_files")
        .select("object_path")
        .eq("job_order_id", jobOrderId);
      const paths = ((existingFiles as { object_path: string }[] | null) ?? []).map(
        (row) => row.object_path,
      );
      if (paths.length) await supabase.storage.from(ASSESSMENT_BUCKET).remove(paths);
      await supabase.from("job_order_assessment_files").delete().eq("job_order_id", jobOrderId);
      await supabase.rpc("withdraw_job_order", { p_job_order_id: jobOrderId });
      return { ok: false, error: answerUpload.error };
    }

    if (candidateUpload.first) {
      assessmentPath = candidateUpload.first.path;
      assessmentName = candidateUpload.first.name;
      assessmentMime = candidateUpload.first.mime;
      assessmentSize = candidateUpload.first.size;
      await supabase
        .from("job_orders")
        .update({
          assessment_file_bucket: ASSESSMENT_BUCKET,
          assessment_file_path: assessmentPath,
          assessment_file_name: assessmentName,
          assessment_file_mime: assessmentMime,
          assessment_file_size: assessmentSize,
        })
        .eq("id", jobOrderId);
    }
  }

  revalidatePath("/employer/job-orders");
  revalidatePath("/hq/jobs");
  revalidatePath("/franchise/jobs");
  revalidatePath("/recruiter/jobs");
  return { ok: true, message: "Job order submitted to Shugulika for approval." };
}

export async function withdrawJobOrderAction(jobOrderId: string): Promise<JobOrderActionResult> {
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

/** HQ / franchise admin denial — reason is mandatory. */
export async function denyJobOrderAction(
  jobOrderId: string,
  reason: string,
): Promise<JobOrderActionResult> {
  const ctx = await requireSession();
  const canDeny = ctx.roles.some((role) => ["hq_admin", "franchise_admin"].includes(role));
  if (!canDeny) return { ok: false, error: "You do not have permission to deny job orders." };

  const trimmed = reason.trim();
  if (trimmed.length < 8) {
    return { ok: false, error: "Enter a denial reason (at least 8 characters)." };
  }

  const supabase = createClient();
  const { data: order } = await supabase
    .from("job_orders")
    .select("id,responsible_org_id,status")
    .eq("id", jobOrderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "Job order not found or not authorized." };
  if (order.status !== "submitted") {
    return { ok: false, error: "Only submitted job orders can be denied." };
  }
  if (
    !ctx.roles.includes("hq_admin") &&
    !memberOrgIds(ctx.memberships).includes(order.responsible_org_id)
  ) {
    return { ok: false, error: "This job order is outside your organization scope." };
  }

  const { error } = await supabase.rpc("deny_job_order", {
    p_job_order_id: jobOrderId,
    p_reason: trimmed,
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
  return { ok: true, message: "Job order denied." };
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

export async function getEmployerAssessmentUrlAction(
  jobOrderId: string,
  fileId?: string,
): Promise<JobOrderActionResult & { url?: string; previewPath?: string }> {
  await requireSession();
  // R-021: never mint raw Storage signed URLs for assessment files.
  // Callers should open the watermarked preview API instead.
  const id = fileId ?? jobOrderId;
  const q = new URLSearchParams({
    source: "assessment_file",
    id,
    jobOrderId,
  });
  return {
    ok: true,
    previewPath: `/api/documents/preview?${q.toString()}`,
    message: "Use the watermarked preview — original signed URLs are disabled.",
  };
}
