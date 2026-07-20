"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { stageByKey, CANDIDATE_FACING_STATUS, REJECTION_REASONS } from "@/lib/constants";
import type { ApplicationRow, CandidateProfileRow } from "@/lib/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
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

/** Advance/reject an application with mandatory controls:
 *  - a rejection requires a reason;
 *  - cannot pass Shortlisted without a recorded screening note. */
export async function advanceStageAction(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const applicationId = String(formData.get("application_id") ?? "");
  const toStage = String(formData.get("to_stage") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const rejectionReason = String(formData.get("rejection_reason") ?? "");

  const app = await loadApplication(applicationId);
  if (!app) return { ok: false, error: "Application not found or not authorized." };

  if (toStage === "rejected") {
    if (!rejectionReason) return { ok: false, error: "A rejection reason is required." };
    const reasonLabel =
      REJECTION_REASONS.find((r) => r.key === rejectionReason)?.label ?? rejectionReason;
    await supabase
      .from("applications")
      .update({ current_stage: "applied_sourced", is_on_hold: false })
      .eq("id", applicationId);
    await supabase.from("application_stage_history").insert({
      application_id: applicationId,
      from_stage: app.current_stage,
      to_stage: "rejected",
      actor_id: await actor(),
      actor_role: "recruiter",
      reason: reasonLabel,
      note: note || null,
      source: "recruiter",
    });
    await writeAudit(
      "application.rejected",
      applicationId,
      app.owning_org_id,
      { stage: app.current_stage },
      { stage: "rejected", reason: reasonLabel },
    );
    await notifyCandidateStatus(app, "rejected");
    revalidatePath(`/recruiter/applications/${applicationId}`);
    revalidatePath("/recruiter/pipeline");
    return { ok: true };
  }

  const target = stageByKey(toStage);
  if (!target || target.stageClass !== "candidate")
    return { ok: false, error: "Invalid target stage." };

  // Gate: cannot pass Shortlisted (ordinal 6) without a screening note.
  // Accept either an existing recruiter note or the note typed on this move form
  // (saved as an internal recruiter note — never shown to the candidate).
  const shortlisted = stageByKey("shortlisted");
  if (shortlisted && target.ordinal > shortlisted.ordinal) {
    const { count } = await supabase
      .from("recruiter_notes")
      .select("id", { count: "exact", head: true })
      .eq("subject_type", "application")
      .eq("subject_id", applicationId);
    if (!count || count === 0) {
      if (!note) {
        return {
          ok: false,
          error:
            "Add an internal screening note below before advancing past Shortlisted. Candidates never see this note.",
        };
      }
      const actorId = await actor();
      if (!actorId) return { ok: false, error: "Not signed in." };
      const { error: noteError } = await supabase.from("recruiter_notes").insert({
        subject_type: "application",
        subject_id: applicationId,
        owning_org_id: app.owning_org_id,
        author_id: actorId,
        body: note,
        visibility: "franchise_internal",
      });
      if (noteError) return { ok: false, error: noteError.message };
    }
  }

  // Gate: entering Client Submission requires an active submission record.
  if (toStage === "client_submission") {
    const { count } = await supabase
      .from("employer_submissions")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId)
      .in("status", ["submitted", "viewed", "shortlisted", "interview_requested", "offered"]);
    if (!count || count === 0) {
      return {
        ok: false,
        error:
          "Create an employer submission (with candidate consent) before moving to Client Submission.",
      };
    }
  }

  await supabase.from("applications").update({ current_stage: toStage }).eq("id", applicationId);
  await supabase.from("application_stage_history").insert({
    application_id: applicationId,
    from_stage: app.current_stage,
    to_stage: toStage,
    actor_id: await actor(),
    actor_role: "recruiter",
    note: note || null,
    source: "recruiter",
  });
  await writeAudit(
    "application.stage_changed",
    applicationId,
    app.owning_org_id,
    { stage: app.current_stage },
    { stage: toStage },
  );
  await notifyCandidateStatus(app, toStage);
  revalidatePath(`/recruiter/applications/${applicationId}`);
  revalidatePath("/recruiter/pipeline");
  revalidatePath("/candidate/notifications");
  return { ok: true };
}

/** Notify the candidate whenever their application status changes. */
async function notifyCandidateStatus(app: ApplicationRow, toStage: string) {
  const supabase = createClient();
  const [{ data: cand }, { data: jobMeta }] = await Promise.all([
    supabase.from("candidate_profiles").select("user_id").eq("id", app.candidate_id).maybeSingle(),
    supabase
      .from("public_jobs")
      .select("title, employer_name")
      .eq("job_order_id", app.job_order_id)
      .maybeSingle(),
  ]);
  const userId = (cand as { user_id: string } | null)?.user_id;
  if (!userId) return;

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

  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    category: "application_status",
    title,
    body,
    subject_type: "application",
    subject_id: app.id,
  });
  if (error) console.error("[notifyCandidateStatus]", error.message);
}

async function notifyCandidate(app: ApplicationRow, title: string, body: string) {
  const supabase = createClient();
  const { data: cand } = await supabase
    .from("candidate_profiles")
    .select("user_id")
    .eq("id", app.candidate_id)
    .maybeSingle();
  const userId = (cand as { user_id: string } | null)?.user_id;
  if (!userId) return;
  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    category: "application_status",
    title,
    body,
    subject_type: "application",
    subject_id: app.id,
  });
  if (error) console.error("[notifyCandidate]", error.message);
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

/** Create a masked, consent-gated employer submission. If employer-specific
 *  consent isn't on file, the submission is created in 'consent_pending' and the
 *  candidate is asked to approve — it cannot be viewed by the employer yet. */
export async function createSubmissionAction(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const applicationId = String(formData.get("application_id") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();
  const app = await loadApplication(applicationId);
  if (!app) return { ok: false, error: "Not authorized." };

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

  // Look for an employer-specific consent covering this employer.
  const { data: consent } = await supabase
    .from("candidate_consents")
    .select("id")
    .eq("candidate_id", app.candidate_id)
    .eq("purpose", "employer_submission")
    .eq("covered_org_id", employerOrgId)
    .is("withdrawn_at", null)
    .maybeSingle();
  const hasConsent = !!consent;

  // Masked snapshot — approved fields only, no name/contact until permitted.
  const disclosed = {
    headline: c?.headline ?? null,
    location: [c?.city, c?.country_code].filter(Boolean).join(", "),
    summary: c?.summary ?? null,
    availability: c?.availability ?? null,
  };

  const { data: sub, error } = await supabase
    .from("employer_submissions")
    .insert({
      application_id: applicationId,
      candidate_id: app.candidate_id,
      job_order_id: app.job_order_id,
      employer_org_id: employerOrgId,
      submitting_org_id: app.owning_org_id,
      submitting_recruiter_id: await actor(),
      consent_id: (consent as { id: string } | null)?.id ?? null,
      status: hasConsent ? "submitted" : "consent_pending",
      is_masked: true,
      summary: summary || null,
      disclosed_profile: disclosed as never,
      disclosed_fields: ["headline", "location", "summary", "availability"],
      cv_document_id: app.cv_document_id,
      submitted_at: hasConsent ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await supabase
    .from("applications")
    .update({ consent_status: hasConsent ? "granted" : "pending" })
    .eq("id", applicationId);
  await writeAudit("submission.created", (sub as { id: string }).id, app.owning_org_id, null, {
    employer: employerOrgId,
    consent: hasConsent,
  });

  // Ask the candidate for employer-specific consent when it's missing.
  if (!hasConsent) {
    await notifyCandidate(
      app,
      "Action required: approve client submission",
      "A recruiter would like to submit your profile to an employer. Please review and approve.",
    );
  }

  revalidatePath(`/recruiter/applications/${applicationId}`);
  revalidatePath("/recruiter/clients");
  return { ok: true };
}
