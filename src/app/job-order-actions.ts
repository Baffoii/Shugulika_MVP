"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { memberOrgIds, requirePortal, requireSession } from "@/lib/auth";
import { assertCanPostJob } from "@/lib/employer-entitlements";
import { jobOrderSchema } from "@/lib/validation";
import type { OrganizationRow } from "@/lib/database.types";
import {
  JOB_ORDER_DENIABLE_STATUSES,
  canEmployerApprove,
  canStaffApproveByShugulika,
  canStaffPublish,
  canStaffRequestChanges,
  canStaffSubmitOffline,
} from "@/lib/jobs";
import { enqueueJobApprovalNotification } from "@/lib/notifications/enqueue-job-approval";
import type { JobOrderOrigin } from "@/lib/jobs/types";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function jobOrderRpc(supabase: ReturnType<typeof createClient>): RpcClient {
  return supabase as unknown as RpcClient;
}

const JOB_ORDER_REVALIDATE_PATHS = [
  "/jobs",
  "/hq/jobs",
  "/franchise/jobs",
  "/recruiter/jobs",
  "/employer/job-orders",
  "/employer/approvals",
  "/hq/audit-log",
] as const;

function revalidateJobOrderPaths() {
  for (const path of JOB_ORDER_REVALIDATE_PATHS) revalidatePath(path);
}

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

  const jobGate = await assertCanPostJob(employerMembership.organization_id);
  if (!jobGate.allowed) {
    return { ok: false, error: jobGate.error ?? "You cannot post a job right now." };
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
    origin: "employer_online",
    status: "submitted_to_shugulika",
    assessment_mode: assessmentMode as "shugulika" | "employer" | "both",
    assessment_seniority: assessmentSeniority as "junior" | "senior",
    assessment_file_bucket: null,
    assessment_file_path: null,
    assessment_file_name: null,
    assessment_file_mime: null,
    assessment_file_size: null,
    ...values,
  } as never);
  if (error) return { ok: false, error: error.message };

  await enqueueJobApprovalNotification({
    jobOrderId,
    kind: "submitted_to_shugulika",
    organizationId: employer.parent_id,
    title: "New job order submitted",
    body: `${employer.name} submitted "${values.title}" for approval.`,
    businessKey: `submitted_to_shugulika:${jobOrderId}`,
  });

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

  revalidateJobOrderPaths();
  return { ok: true, message: "Job order submitted to Shugulika for approval." };
}

export async function withdrawJobOrderAction(jobOrderId: string): Promise<JobOrderActionResult> {
  await requirePortal("employer");

  const supabase = createClient();
  const { error } = await jobOrderRpc(supabase).rpc("withdraw_job_order", {
    p_job_order_id: jobOrderId,
  });
  if (error) return { ok: false, error: error.message };

  revalidateJobOrderPaths();
  return { ok: true, message: "Job order withdrawn." };
}

type JobOrderGateRow = {
  id: string;
  title: string;
  responsible_org_id: string;
  employer_org_id: string;
  status: string;
  origin: JobOrderOrigin | null;
};

async function loadJobOrderGate(
  supabase: ReturnType<typeof createClient>,
  jobOrderId: string,
): Promise<JobOrderGateRow | null> {
  // origin columns are ahead of frozen database.types.ts — query via loose client.
  const loose = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => { maybeSingle: () => Promise<{ data: JobOrderGateRow | null }> };
      };
    };
  };
  const { data } = await loose
    .from("job_orders")
    .select("id,title,responsible_org_id,employer_org_id,status,origin")
    .eq("id", jobOrderId)
    .maybeSingle();
  return data ?? null;
}

function assertStaffScope(
  ctx: Awaited<ReturnType<typeof requireSession>>,
  order: JobOrderGateRow,
): string | null {
  if (
    !ctx.roles.includes("hq_admin") &&
    !memberOrgIds(ctx.memberships).includes(order.responsible_org_id)
  ) {
    return "This job order is outside your organization scope.";
  }
  return null;
}

/** @deprecated Use approveJobOrderByShugulikaAction + publishJobOrderAction. */
export async function approveAndPublishJobOrderAction(
  jobOrderId: string,
): Promise<JobOrderActionResult> {
  void jobOrderId;
  return {
    ok: false,
    error: "Approve and publish are separate steps. Approve first, then publish.",
  };
}

export async function approveJobOrderByShugulikaAction(
  jobOrderId: string,
): Promise<JobOrderActionResult> {
  const ctx = await requireSession();
  const canApprove = ctx.roles.some((role) =>
    ["hq_admin", "franchise_admin", "recruiter"].includes(role),
  );
  if (!canApprove) return { ok: false, error: "You do not have permission to approve jobs." };

  const supabase = createClient();
  const order = await loadJobOrderGate(supabase, jobOrderId);
  if (!order) return { ok: false, error: "Job order not found or not authorized." };
  const origin = (order.origin ?? "employer_online") as JobOrderOrigin;
  if (!canStaffApproveByShugulika(order.status, origin)) {
    return { ok: false, error: "This job order is not ready for Shugulika approval." };
  }
  const scopeError = assertStaffScope(ctx, order);
  if (scopeError) return { ok: false, error: scopeError };

  const { error } = await jobOrderRpc(supabase).rpc("approve_job_order_by_shugulika", {
    p_job_order_id: jobOrderId,
  });
  if (error) return { ok: false, error: error.message };

  await enqueueJobApprovalNotification({
    jobOrderId,
    kind: "approved_by_shugulika",
    organizationId: order.responsible_org_id,
    title: "Job order approved by Shugulika",
    body: `"${order.title}" was approved and is ready to publish.`,
    businessKey: `approved_by_shugulika:${jobOrderId}`,
  });

  revalidateJobOrderPaths();
  return { ok: true, message: "Job order approved by Shugulika." };
}

export async function publishJobOrderAction(jobOrderId: string): Promise<JobOrderActionResult> {
  const ctx = await requireSession();
  const canPublish = ctx.roles.some((role) =>
    ["hq_admin", "franchise_admin", "recruiter"].includes(role),
  );
  if (!canPublish) return { ok: false, error: "You do not have permission to publish jobs." };

  const supabase = createClient();
  const order = await loadJobOrderGate(supabase, jobOrderId);
  if (!order) return { ok: false, error: "Job order not found or not authorized." };
  const origin = (order.origin ?? "employer_online") as JobOrderOrigin;
  if (!canStaffPublish(order.status, origin)) {
    return { ok: false, error: "This job order is not ready to publish." };
  }
  const scopeError = assertStaffScope(ctx, order);
  if (scopeError) return { ok: false, error: scopeError };

  const { error } = await jobOrderRpc(supabase).rpc("publish_job_order", {
    p_job_order_id: jobOrderId,
  });
  if (error) return { ok: false, error: error.message };

  await enqueueJobApprovalNotification({
    jobOrderId,
    kind: "published",
    organizationId: order.responsible_org_id,
    title: "Job order published",
    body: `"${order.title}" is now live.`,
    businessKey: `published:${jobOrderId}`,
  });

  revalidateJobOrderPaths();
  return { ok: true, message: "Job published." };
}

export async function approveJobOrderByEmployerAction(
  jobOrderId: string,
): Promise<JobOrderActionResult> {
  await requirePortal("employer");

  const supabase = createClient();
  const order = await loadJobOrderGate(supabase, jobOrderId);
  if (!order) return { ok: false, error: "Job order not found or not authorized." };
  const origin = (order.origin ?? "employer_online") as JobOrderOrigin;
  if (!canEmployerApprove(order.status, origin)) {
    return { ok: false, error: "This job order is not awaiting your approval." };
  }

  const { error } = await jobOrderRpc(supabase).rpc("approve_job_order_by_employer", {
    p_job_order_id: jobOrderId,
  });
  if (error) return { ok: false, error: error.message };

  await enqueueJobApprovalNotification({
    jobOrderId,
    kind: "approved_by_employer",
    organizationId: order.responsible_org_id,
    title: "Employer approved job order",
    body: `Employer approved "${order.title}".`,
    businessKey: `approved_by_employer:${jobOrderId}`,
  });

  revalidateJobOrderPaths();
  return { ok: true, message: "Job order approved." };
}

export async function requestJobOrderChangesAction(
  jobOrderId: string,
  message: string,
  changes: Array<{ field: string; instruction: string }>,
): Promise<JobOrderActionResult> {
  const ctx = await requireSession();
  const canRequest = ctx.roles.some((role) =>
    ["hq_admin", "franchise_admin", "recruiter"].includes(role),
  );
  if (!canRequest) {
    return { ok: false, error: "You do not have permission to request job-order changes." };
  }

  const trimmed = message.trim();
  if (trimmed.length < 8) {
    return { ok: false, error: "Enter a change-request message (at least 8 characters)." };
  }
  if (!changes.length) {
    return { ok: false, error: "Add at least one requested change." };
  }

  const supabase = createClient();
  const order = await loadJobOrderGate(supabase, jobOrderId);
  if (!order) return { ok: false, error: "Job order not found or not authorized." };
  if (!canStaffRequestChanges(order.status)) {
    return { ok: false, error: "Changes can only be requested while the order is under review." };
  }
  const scopeError = assertStaffScope(ctx, order);
  if (scopeError) return { ok: false, error: scopeError };

  const { error } = await jobOrderRpc(supabase).rpc("request_job_order_changes", {
    p_job_order_id: jobOrderId,
    p_message: trimmed,
    p_changes: changes,
  });
  if (error) return { ok: false, error: error.message };

  await enqueueJobApprovalNotification({
    jobOrderId,
    kind: "changes_requested",
    organizationId: order.employer_org_id,
    title: "Changes requested on job order",
    body: trimmed,
    businessKey: `changes_requested:${jobOrderId}:${Date.now()}`,
  });

  revalidateJobOrderPaths();
  return { ok: true, message: "Change request sent." };
}

export async function submitJobOrderWorkflowAction(
  jobOrderId: string,
): Promise<JobOrderActionResult> {
  const ctx = await requireSession();
  const supabase = createClient();
  const order = await loadJobOrderGate(supabase, jobOrderId);
  if (!order) return { ok: false, error: "Job order not found or not authorized." };
  const origin = (order.origin ?? "employer_online") as JobOrderOrigin;

  if (origin === "employer_online") {
    await requirePortal("employer");
  } else {
    const canSubmit = ctx.roles.some((role) =>
      ["hq_admin", "franchise_admin", "recruiter"].includes(role),
    );
    if (!canSubmit) return { ok: false, error: "You do not have permission to submit this draft." };
    if (!canStaffSubmitOffline(order.status, origin)) {
      return { ok: false, error: "This offline draft is not ready to send for employer approval." };
    }
    const scopeError = assertStaffScope(ctx, order);
    if (scopeError) return { ok: false, error: scopeError };
  }

  const { error } = await jobOrderRpc(supabase).rpc("submit_job_order_to_shugulika", {
    p_job_order_id: jobOrderId,
  });
  if (error) return { ok: false, error: error.message };

  const kind =
    origin === "shugulika_offline" ? "awaiting_employer_approval" : "submitted_to_shugulika";
  await enqueueJobApprovalNotification({
    jobOrderId,
    kind,
    organizationId:
      origin === "shugulika_offline" ? order.employer_org_id : order.responsible_org_id,
    title:
      origin === "shugulika_offline"
        ? "Job order awaiting your approval"
        : "Job order submitted to Shugulika",
    body: `"${order.title}" needs review.`,
    businessKey: `${kind}:${jobOrderId}`,
  });

  revalidateJobOrderPaths();
  return {
    ok: true,
    message:
      origin === "shugulika_offline"
        ? "Sent to the employer for approval."
        : "Submitted to Shugulika for approval.",
  };
}

export async function createOfflineJobOrderDraftAction(
  _previous: JobOrderActionResult,
  formData: FormData,
): Promise<JobOrderActionResult> {
  const ctx = await requireSession();
  const canCreate = ctx.roles.some((role) =>
    ["hq_admin", "franchise_admin", "recruiter"].includes(role),
  );
  if (!canCreate) {
    return { ok: false, error: "You do not have permission to create offline job drafts." };
  }

  const employerOrgId = String(formData.get("employer_org_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const countryCode = String(formData.get("country_code") ?? "TZ").trim();
  if (!employerOrgId) return { ok: false, error: "Choose an employer organization." };
  if (title.length < 2) return { ok: false, error: "Enter a job title." };

  const vacancyRaw = Number(formData.get("vacancy_count") ?? 1);
  const vacancyCount = Number.isFinite(vacancyRaw) ? Math.max(1, Math.floor(vacancyRaw)) : 1;

  const supabase = createClient();
  const { data, error } = await jobOrderRpc(supabase).rpc("create_offline_job_order_draft", {
    p_employer_org_id: employerOrgId,
    p_title: title,
    p_country_code: countryCode,
    p_description: optionalText(formData, "description") ?? null,
    p_requirements: optionalText(formData, "requirements") ?? null,
    p_city: optionalText(formData, "city") ?? null,
    p_vacancy_count: vacancyCount,
    p_recruitment_path: String(formData.get("recruitment_path") ?? "B"),
    p_salary_min: optionalText(formData, "salary_min") ? Number(formData.get("salary_min")) : null,
    p_salary_max: optionalText(formData, "salary_max") ? Number(formData.get("salary_max")) : null,
    p_salary_currency: optionalText(formData, "salary_currency") ?? null,
    p_application_deadline: optionalText(formData, "application_deadline") ?? null,
    p_department: optionalText(formData, "department") ?? null,
    p_employment_type: optionalText(formData, "employment_type") ?? null,
    p_work_arrangement: optionalText(formData, "work_arrangement") ?? null,
    p_experience_level: optionalText(formData, "experience_level") ?? null,
  });
  if (error) return { ok: false, error: error.message };

  void data;
  revalidateJobOrderPaths();
  return {
    ok: true,
    message: "Offline job draft created. Send it for employer approval when ready.",
  };
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
  const order = await loadJobOrderGate(supabase, jobOrderId);
  if (!order) return { ok: false, error: "Job order not found or not authorized." };
  if (!JOB_ORDER_DENIABLE_STATUSES.has(order.status)) {
    return { ok: false, error: "Only job orders under review can be denied." };
  }
  const scopeError = assertStaffScope(ctx, order);
  if (scopeError) return { ok: false, error: scopeError };

  const { error } = await jobOrderRpc(supabase).rpc("deny_job_order", {
    p_job_order_id: jobOrderId,
    p_reason: trimmed,
  });
  if (error) return { ok: false, error: error.message };

  await enqueueJobApprovalNotification({
    jobOrderId,
    kind: "denied",
    organizationId: order.employer_org_id,
    title: "Job order denied",
    body: trimmed,
    businessKey: `denied:${jobOrderId}`,
  });

  revalidateJobOrderPaths();
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
