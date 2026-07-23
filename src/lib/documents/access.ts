import "server-only";
import type { SessionContext } from "@/lib/auth";
import { isHqAdmin } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { WatermarkContext } from "@/lib/documents/watermark";
import type { DocumentSourceKind, DocumentAccessScope } from "@/lib/documents/access-types";
import type { Role } from "@/lib/constants";

export type { DocumentSourceKind, DocumentAccessScope };

export type ResolvedDocument = {
  sourceKind: DocumentSourceKind;
  sourceId: string;
  bucketId: string;
  objectPath: string;
  mimeType: string | null;
  title: string | null;
  jobOrderId: string | null;
  applicationId: string | null;
  submissionId: string | null;
  orgContextId: string | null;
  watermark: WatermarkContext;
};

export class DocumentAccessError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "DocumentAccessError";
    this.status = status;
  }
}

function viewerLabel(ctx: SessionContext): string {
  return ctx.profile?.full_name?.trim() || ctx.email || ctx.userId;
}

function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function timestampLabel(d = new Date()): string {
  return d
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

async function orgName(
  supabase: ReturnType<typeof createClient>,
  orgId: string | null | undefined,
): Promise<string> {
  if (!orgId) return "—";
  const { data } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  return data?.name?.trim() || "—";
}

async function jobMeta(
  supabase: ReturnType<typeof createClient>,
  jobOrderId: string | null | undefined,
): Promise<{ title: string; employerOrgId: string | null; employerName: string }> {
  if (!jobOrderId) return { title: "—", employerOrgId: null, employerName: "—" };
  const { data } = await supabase
    .from("job_orders")
    .select("title,employer_org_id")
    .eq("id", jobOrderId)
    .maybeSingle();
  const employerOrgId = data?.employer_org_id ?? null;
  return {
    title: data?.title?.trim() || "—",
    employerOrgId,
    employerName: await orgName(supabase, employerOrgId),
  };
}

async function assertCandidateDocumentPreview(
  ctx: SessionContext,
  documentId: string,
  opts: { applicationId?: string | null; submissionId?: string | null },
): Promise<ResolvedDocument> {
  const supabase = createClient();
  const { data: doc, error } = await supabase
    .from("candidate_documents")
    .select("id,candidate_id,doc_type,title,bucket_id,object_path,mime_type,status")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !doc) throw new DocumentAccessError("Document not found.", 404);
  if (doc.status !== "active") throw new DocumentAccessError("Document is not available.", 404);

  const { data: profile } = await supabase
    .from("candidate_profiles")
    .select("id,user_id,given_name,family_name")
    .eq("id", doc.candidate_id)
    .maybeSingle();

  const candidateName =
    [profile?.given_name, profile?.family_name].filter(Boolean).join(" ").trim() ||
    `Candidate ${shortId(doc.candidate_id)}`;

  const isOwner = !!ctx.candidate && ctx.candidate.id === doc.candidate_id;
  let jobLabel = "—";
  let employerLabel = "—";
  let jobOrderId: string | null = null;
  let applicationId: string | null = opts.applicationId ?? null;
  let submissionId: string | null = opts.submissionId ?? null;
  let orgContextId: string | null = null;
  let entitled = isOwner || isHqAdmin(ctx.roles);

  if (opts.submissionId) {
    const { data: sub } = await supabase
      .from("employer_submissions")
      .select("id,cv_document_id,employer_org_id,job_order_id,application_id,access_revoked_at")
      .eq("id", opts.submissionId)
      .maybeSingle();
    if (!sub || sub.cv_document_id !== documentId) {
      throw new DocumentAccessError("This document is not part of the submission pack.", 403);
    }
    if (sub.access_revoked_at) {
      throw new DocumentAccessError("Submission access has been revoked.", 403);
    }
    submissionId = sub.id;
    jobOrderId = sub.job_order_id;
    applicationId = sub.application_id;
    orgContextId = sub.employer_org_id;
    const meta = await jobMeta(supabase, sub.job_order_id);
    jobLabel = meta.title;
    employerLabel =
      meta.employerName !== "—" ? meta.employerName : await orgName(supabase, sub.employer_org_id);
    entitled = true;
  } else if (opts.applicationId) {
    const { data: app } = await supabase
      .from("applications")
      .select("id,candidate_id,job_order_id,owning_org_id")
      .eq("id", opts.applicationId)
      .maybeSingle();
    if (!app || app.candidate_id !== doc.candidate_id) {
      throw new DocumentAccessError("Document is not linked to this application.", 403);
    }
    applicationId = app.id;
    jobOrderId = app.job_order_id;
    orgContextId = app.owning_org_id;
    const meta = await jobMeta(supabase, app.job_order_id);
    jobLabel = meta.title;
    employerLabel = meta.employerName;
    entitled = true;
  } else if (!entitled) {
    const isStaff = ctx.roles.some((r: Role) =>
      ["recruiter", "franchise_admin", "hq_admin", "operations"].includes(r),
    );
    if (!isStaff) throw new DocumentAccessError("Not permitted to preview this document.", 403);
    entitled = true;
  }

  if (!entitled) throw new DocumentAccessError("Not permitted to preview this document.", 403);

  return {
    sourceKind: "candidate_document",
    sourceId: doc.id,
    bucketId: doc.bucket_id,
    objectPath: doc.object_path,
    mimeType: doc.mime_type,
    title: doc.title,
    jobOrderId,
    applicationId,
    submissionId,
    orgContextId,
    watermark: {
      candidateLabel: `${candidateName} (${shortId(doc.candidate_id)})`,
      jobLabel,
      employerLabel,
      viewerLabel: viewerLabel(ctx),
      timestampLabel: timestampLabel(),
    },
  };
}

async function assertAssessmentFilePreview(
  ctx: SessionContext,
  fileId: string,
  jobOrderId?: string | null,
): Promise<ResolvedDocument> {
  const supabase = createClient();
  let query = supabase
    .from("job_order_assessment_files")
    .select("id,job_order_id,kind,bucket_id,object_path,file_name,mime_type")
    .eq("id", fileId);
  if (jobOrderId) query = query.eq("job_order_id", jobOrderId);
  const { data: file, error } = await query.maybeSingle();

  if (file && !error) {
    if (file.kind === "answer_key" && ctx.roles.includes("candidate") && !isHqAdmin(ctx.roles)) {
      throw new DocumentAccessError("Not permitted to preview answer keys.", 403);
    }

    const meta = await jobMeta(supabase, file.job_order_id);

    return {
      sourceKind: "assessment_file",
      sourceId: file.id,
      bucketId: file.bucket_id,
      objectPath: file.object_path,
      mimeType: file.mime_type,
      title: file.file_name,
      jobOrderId: file.job_order_id,
      applicationId: null,
      submissionId: null,
      orgContextId: meta.employerOrgId,
      watermark: {
        candidateLabel: ctx.candidate
          ? `Candidate ${shortId(ctx.candidate.id)}`
          : "Staff / employer review",
        jobLabel: meta.title === "—" ? "Job assessment" : meta.title,
        employerLabel: meta.employerName,
        viewerLabel: viewerLabel(ctx),
        timestampLabel: timestampLabel(),
      },
    };
  }

  // Legacy: fileId may be the job_order id when only job_orders.assessment_file_* is set.
  const legacyJobId = jobOrderId ?? fileId;
  const { data: job } = await supabase
    .from("job_orders")
    .select(
      "id,title,employer_org_id,assessment_file_bucket,assessment_file_path,assessment_file_name,assessment_file_mime",
    )
    .eq("id", legacyJobId)
    .maybeSingle();
  if (!job?.assessment_file_bucket || !job.assessment_file_path) {
    throw new DocumentAccessError("Assessment file not found.", 404);
  }

  const employerName = await orgName(supabase, job.employer_org_id);
  return {
    sourceKind: "assessment_file",
    sourceId: job.id,
    bucketId: job.assessment_file_bucket,
    objectPath: job.assessment_file_path,
    mimeType: job.assessment_file_mime,
    title: job.assessment_file_name,
    jobOrderId: job.id,
    applicationId: null,
    submissionId: null,
    orgContextId: job.employer_org_id,
    watermark: {
      candidateLabel: ctx.candidate
        ? `Candidate ${shortId(ctx.candidate.id)}`
        : "Staff / employer review",
      jobLabel: job.title?.trim() || "Job assessment",
      employerLabel: employerName,
      viewerLabel: viewerLabel(ctx),
      timestampLabel: timestampLabel(),
    },
  };
}

/** Resolve + authorize a preview request. */
export async function resolvePreviewAccess(
  ctx: SessionContext,
  sourceKind: DocumentSourceKind,
  sourceId: string,
  opts: {
    applicationId?: string | null;
    submissionId?: string | null;
    jobOrderId?: string | null;
  } = {},
): Promise<ResolvedDocument> {
  if (sourceKind === "candidate_document") {
    return assertCandidateDocumentPreview(ctx, sourceId, opts);
  }
  return assertAssessmentFilePreview(ctx, sourceId, opts.jobOrderId);
}

/** Resolve + authorize an original-file export (HQ Super Admin only). */
export async function resolveExportAccess(
  ctx: SessionContext,
  sourceKind: DocumentSourceKind,
  sourceId: string,
): Promise<ResolvedDocument> {
  if (!isHqAdmin(ctx.roles)) {
    throw new DocumentAccessError("Original file export is restricted to Super Admin.", 403);
  }
  return resolvePreviewAccess(ctx, sourceKind, sourceId, {});
}

/** Download original bytes after entitlement. Prefers service role (bypasses Storage RLS). */
export async function downloadOriginalBytes(
  resolved: ResolvedDocument,
  userClient: ReturnType<typeof createClient>,
): Promise<Blob> {
  const admin = createServiceRoleClient();
  const client = admin ?? userClient;
  const { data, error } = await client.storage
    .from(resolved.bucketId)
    .download(resolved.objectPath);
  if (error || !data) {
    if (!admin) {
      throw new DocumentAccessError(
        "Could not load the file. Configure SUPABASE_SERVICE_ROLE_KEY for employer/original access after Storage hardening.",
        503,
      );
    }
    throw new DocumentAccessError(error?.message ?? "Could not load the file.", 502);
  }
  return data;
}

export async function writeDocumentAccessEvent(
  ctx: SessionContext,
  resolved: ResolvedDocument,
  scope: DocumentAccessScope,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const supabase = createClient();
  const watermarkText =
    scope === "preview"
      ? [
          resolved.watermark.candidateLabel,
          resolved.watermark.jobLabel,
          resolved.watermark.employerLabel,
          resolved.watermark.viewerLabel,
          resolved.watermark.timestampLabel,
        ].join(" · ")
      : null;

  await supabase.from("document_access_events").insert({
    actor_id: ctx.userId,
    source_kind: resolved.sourceKind,
    source_id: resolved.sourceId,
    access_scope: scope,
    bucket_id: resolved.bucketId,
    object_path: resolved.objectPath,
    job_order_id: resolved.jobOrderId,
    application_id: resolved.applicationId,
    submission_id: resolved.submissionId,
    org_context_id: resolved.orgContextId,
    watermark_text: watermarkText,
    metadata: {
      mime_type: resolved.mimeType,
      title: resolved.title,
      ...extra,
    },
  });

  await supabase.from("audit_logs").insert({
    actor_id: ctx.userId,
    action: scope === "preview" ? "document.preview" : "document.export",
    entity_type: resolved.sourceKind,
    entity_id: resolved.sourceId,
    org_context_id: resolved.orgContextId,
    before_value: null,
    after_value: null,
    metadata: {
      access_scope: scope,
      bucket_id: resolved.bucketId,
      object_path: resolved.objectPath,
      job_order_id: resolved.jobOrderId,
      application_id: resolved.applicationId,
      submission_id: resolved.submissionId,
      watermark: watermarkText,
      ...extra,
    },
  });
}
