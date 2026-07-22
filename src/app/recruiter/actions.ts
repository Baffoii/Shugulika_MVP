"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  stageByKey,
  CANDIDATE_FACING_STATUS,
  REJECTION_REASONS,
  allowedNextStages,
} from "@/lib/constants";
import type { ApplicationRow, CandidateProfileRow } from "@/lib/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Stage/note succeeded, but a side effect (e.g. candidate notify) failed. */
  warning?: string;
}

async function actor(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function loadApplication(id: string): Promise<ApplicationRow | null> {
  const supabase = createClient();
  const { data } = await supabase.from("applications").select("*").eq("id", id).maybeSingle();
  return (data as ApplicationRow | null) ?? null;
}

async function writeAudit(
  action: string,
  entityId: string,
  orgId: string | null,
  before: unknown,
  after: unknown,
) {
  const supabase = createClient();
  const actorId = await actor();
  await supabase.from("audit_logs").insert({
    actor_id: actorId,
    action,
    entity_type: "application",
    entity_id: entityId,
    org_context_id: orgId,
    before_value: before as never,
    after_value: after as never,
  });
}

function revalidateApplicationPaths(applicationId: string) {
  revalidatePath(`/recruiter/applications/${applicationId}`);
  revalidatePath("/recruiter/pipeline");
  revalidatePath("/candidate/notifications");
  revalidatePath("/employer/submissions");
}

/** Shared stage transition with forward-only + rejection permanence rules. */
async function moveApplicationToStage(
  app: ApplicationRow,
  toStage: string,
  opts: {
    note?: string;
    source?: string;
    allowAuto?: boolean;
  } = {},
): Promise<ActionResult> {
  const supabase = createClient();
  const note = opts.note?.trim() ?? "";
  const source = opts.source ?? "recruiter";

  if (app.withdrawn_at) {
    return {
      ok: false,
      error: "This application was withdrawn by the candidate and cannot be advanced.",
    };
  }
  if (app.current_stage === "rejected") {
    return {
      ok: false,
      error: "This candidate was rejected and cannot be moved to another stage.",
    };
  }

  const target = stageByKey(toStage);
  if (!target || target.stageClass !== "candidate" || target.legacy) {
    return { ok: false, error: "Invalid target stage." };
  }

  const current = stageByKey(app.current_stage);
  if (current && !opts.allowAuto && target.ordinal <= current.ordinal) {
    return {
      ok: false,
      error: "Candidates can only move forward. Going back to an earlier stage is not allowed.",
    };
  }

  if (!opts.allowAuto) {
    const allowed = allowedNextStages(app.current_stage).map((s) => s.key);
    if (!allowed.includes(toStage)) {
      return {
        ok: false,
        error: `Cannot move from ${current?.label ?? app.current_stage} to ${target.label}.`,
      };
    }
  }

  if (toStage === "client_submission") {
    const submission = await ensureEmployerSubmission(app, note);
    if (!submission.ok) return submission;
  }

  const { error } = await supabase
    .from("applications")
    .update({ current_stage: toStage })
    .eq("id", app.id);
  if (error) return { ok: false, error: error.message };

  await supabase.from("application_stage_history").insert({
    application_id: app.id,
    from_stage: app.current_stage,
    to_stage: toStage,
    actor_id: await actor(),
    actor_role: "recruiter",
    note: note || null,
    source,
  });
  await writeAudit(
    "application.stage_changed",
    app.id,
    app.owning_org_id,
    { stage: app.current_stage },
    { stage: toStage },
  );
  const notify = await notifyCandidateStatus(app, toStage);
  revalidateApplicationPaths(app.id);
  return notify.ok ? { ok: true } : { ok: true, warning: notify.error };
}

/** Advance/reject an application:
 *  - forward-only stage moves;
 *  - rejection is permanent and records the stage where it happened;
 *  - Client Submission auto-creates the employer-visible CV pack. */
export async function advanceStageAction(formData: FormData): Promise<ActionResult> {
  const applicationId = String(formData.get("application_id") ?? "");
  const toStage = String(formData.get("to_stage") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const rejectionReason = String(formData.get("rejection_reason") ?? "");

  const app = await loadApplication(applicationId);
  if (!app) return { ok: false, error: "Application not found or not authorized." };

  if (toStage === "rejected") {
    return rejectApplication(app, rejectionReason, note);
  }

  return moveApplicationToStage(app, toStage, { note, source: "recruiter" });
}

/** Testing submitted → automatically enter Test Review / Grading. */
export async function markTestingSubmittedAction(formData: FormData): Promise<ActionResult> {
  const applicationId = String(formData.get("application_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const testName = String(formData.get("test_name") ?? "").trim();
  const testScore = String(formData.get("test_score") ?? "").trim();
  const app = await loadApplication(applicationId);
  if (!app) return { ok: false, error: "Application not found or not authorized." };
  if (app.current_stage !== "testing") {
    return {
      ok: false,
      error: "Testing can only be marked submitted while the candidate is in Testing.",
    };
  }

  const supabase = createClient();
  const { error: scoreError } = await supabase
    .from("applications")
    .update({
      test_name: testName || null,
      test_score: testScore || null,
    })
    .eq("id", app.id);
  if (scoreError) return { ok: false, error: scoreError.message };

  return moveApplicationToStage(
    { ...app, test_name: testName || null, test_score: testScore || null },
    "test_review",
    {
      note,
      source: "testing_submitted",
      allowAuto: true,
    },
  );
}

/** Interview Screening completed → automatically enter Interview Review. */
export async function markInterviewCompleteAction(formData: FormData): Promise<ActionResult> {
  const applicationId = String(formData.get("application_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const app = await loadApplication(applicationId);
  if (!app) return { ok: false, error: "Application not found or not authorized." };
  if (app.current_stage !== "interview_screening") {
    return {
      ok: false,
      error: "Interview can only be marked complete while the candidate is in Interview Screening.",
    };
  }
  return moveApplicationToStage(app, "interview_review", {
    note,
    source: "interview_completed",
    allowAuto: true,
  });
}

async function rejectApplication(
  app: ApplicationRow,
  rejectionReason: string,
  note: string,
): Promise<ActionResult> {
  const supabase = createClient();
  if (app.current_stage === "rejected") {
    return { ok: false, error: "This candidate is already rejected." };
  }
  if (app.withdrawn_at) {
    return { ok: false, error: "This application was withdrawn and cannot be rejected." };
  }
  if (!rejectionReason) return { ok: false, error: "A rejection reason is required." };

  const reasonLabel =
    REJECTION_REASONS.find((r) => r.key === rejectionReason)?.label ?? rejectionReason;
  const rejectedAt = new Date().toISOString();
  const rejectedFrom = app.current_stage;

  const { error } = await supabase
    .from("applications")
    .update({
      current_stage: "rejected",
      is_on_hold: false,
      rejected_from_stage: rejectedFrom,
      rejected_at: rejectedAt,
      rejection_reason: reasonLabel,
    })
    .eq("id", app.id);
  if (error) return { ok: false, error: error.message };

  await supabase.from("application_stage_history").insert({
    application_id: app.id,
    from_stage: rejectedFrom,
    to_stage: "rejected",
    actor_id: await actor(),
    actor_role: "recruiter",
    reason: reasonLabel,
    note: note || `Rejected during ${stageByKey(rejectedFrom)?.label ?? rejectedFrom}`,
    source: "recruiter",
  });
  await writeAudit(
    "application.rejected",
    app.id,
    app.owning_org_id,
    { stage: rejectedFrom },
    { stage: "rejected", reason: reasonLabel, rejected_from_stage: rejectedFrom },
  );
  const notify = await notifyCandidateStatus(app, "rejected");
  revalidateApplicationPaths(app.id);
  return notify.ok ? { ok: true } : { ok: true, warning: notify.error };
}

/** Notify the candidate whenever their application status changes. */
async function notifyCandidateStatus(app: ApplicationRow, toStage: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: jobMeta } = await supabase
    .from("public_jobs")
    .select("title, employer_name")
    .eq("job_order_id", app.job_order_id)
    .maybeSingle();

  const meta = jobMeta as { title: string; employer_name: string } | null;
  const roleLabel = meta ? `${meta.title} at ${meta.employer_name}` : "your application";
  const statusLabel = CANDIDATE_FACING_STATUS[toStage] ?? toStage.replace(/_/g, " ");

  const title =
    toStage === "rejected"
      ? "Application update"
      : toStage === "hired"
        ? "Congratulations — hired"
        : "Application progress update";
  const body =
    toStage === "rejected"
      ? `Your application for ${roleLabel} was not selected.`
      : toStage === "hired"
        ? `Congratulations — your application for ${roleLabel} moved to Hired.`
        : `Your application for ${roleLabel} moved to: ${statusLabel}.`;

  // Security-definer RPC — does not depend on notif_staff_insert RLS.
  const { error } = await supabase.rpc("notify_candidate_of_application_status", {
    p_application_id: app.id,
    p_title: title,
    p_body: body,
    p_category: "application_status",
  });
  if (error) {
    console.error("[notifyCandidateStatus]", error.message);
    return {
      ok: false,
      error: `Stage updated, but the candidate was not notified: ${error.message}`,
    };
  }
  return { ok: true };
}

export async function addNoteAction(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const applicationId = String(formData.get("application_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const visibility = String(formData.get("visibility") ?? "franchise_internal");
  if (!body) return { ok: false, error: "Note cannot be empty." };
  const app = await loadApplication(applicationId);
  if (!app) return { ok: false, error: "Not authorized." };
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "Not signed in." };
  const { error } = await supabase.from("recruiter_notes").insert({
    subject_type: "application",
    subject_id: applicationId,
    owning_org_id: app.owning_org_id,
    author_id: actorId,
    body,
    visibility,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/recruiter/applications/${applicationId}`);
  return { ok: true };
}

/** Ensure the employer has one active candidate pack for this application.
 * Called automatically when the recruiter advances to Client Submission. */
async function ensureEmployerSubmission(
  app: ApplicationRow,
  summary: string,
): Promise<ActionResult> {
  const supabase = createClient();
  if (app.withdrawn_at) {
    return { ok: false, error: "The candidate withdrew this application." };
  }

  const { data: existing } = await supabase
    .from("employer_submissions")
    .select("id,status")
    .eq("application_id", app.id)
    .in("status", ["submitted", "viewed", "shortlisted", "interview_requested", "offered"])
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true };

  const { data: jo } = await supabase
    .from("job_orders")
    .select("employer_org_id")
    .eq("id", app.job_order_id)
    .maybeSingle();
  const employerOrgId = (jo as { employer_org_id: string } | null)?.employer_org_id;
  if (!employerOrgId) return { ok: false, error: "Job order not found." };

  const { data: cand } = await supabase
    .from("candidate_profiles")
    .select("*")
    .eq("id", app.candidate_id)
    .maybeSingle();
  const c = cand as CandidateProfileRow | null;
  const fullName = [c?.given_name, c?.family_name].filter(Boolean).join(" ").trim() || null;

  // Employer-facing snapshot at Client Submission: identity, profile, CV, and
  // skills-test result (null score → N/A in the employer UI).
  const disclosed = {
    full_name: fullName,
    given_name: c?.given_name ?? null,
    family_name: c?.family_name ?? null,
    headline: c?.headline ?? null,
    location: [c?.city, c?.country_code].filter(Boolean).join(", "),
    summary: c?.summary ?? null,
    availability: c?.availability ?? null,
    test_name: app.test_name ?? null,
    test_score: app.test_score ?? null,
  };

  const { data: sub, error } = await supabase
    .from("employer_submissions")
    .insert({
      application_id: app.id,
      candidate_id: app.candidate_id,
      job_order_id: app.job_order_id,
      employer_org_id: employerOrgId,
      submitting_org_id: app.owning_org_id,
      submitting_recruiter_id: await actor(),
      consent_id: null,
      status: "submitted",
      is_masked: false,
      summary: summary.trim() || null,
      disclosed_profile: disclosed as never,
      disclosed_fields: [
        "full_name",
        "given_name",
        "family_name",
        "headline",
        "location",
        "summary",
        "availability",
        "test_name",
        "test_score",
      ],
      cv_document_id: app.cv_document_id,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await supabase.from("applications").update({ consent_status: "granted" }).eq("id", app.id);
  await writeAudit("submission.created", (sub as { id: string }).id, app.owning_org_id, null, {
    employer: employerOrgId,
    consent_basis: "active_application",
  });

  revalidatePath("/recruiter/clients");
  revalidatePath("/employer/submissions");
  return { ok: true };
}
