"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, memberOrgIds, primaryOrgId } from "@/lib/auth";
import { rolesCanAccessPortal } from "@/lib/rbac";
import { SOURCED_CONTACT_STATUSES, type SourcedContactStatusKey } from "@/lib/constants";
import type { ApplicationRow, JobOrderRow } from "@/lib/database.types";

export interface SourceActionResult {
  ok: boolean;
  error?: string;
  applicationId?: string;
  /** Existing application on this job — duplicate-application handling. */
  duplicate?: boolean;
  /** Withdrawn/rejected row that was reopened. */
  reopened?: boolean;
}

async function requireRecruiter() {
  const session = await getSessionContext();
  if (!session || !rolesCanAccessPortal(session.roles, "recruiter")) {
    return null;
  }
  return session;
}

async function writeAudit(
  action: string,
  entityType: string,
  entityId: string,
  orgId: string | null,
  before: unknown,
  after: unknown,
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("audit_logs").insert({
    actor_id: user?.id ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    org_context_id: orgId,
    before_value: before as never,
    after_value: after as never,
  });
}

/**
 * Create (or reopen) a recruiter-sourced application for a discoverable candidate.
 * Enforces UK(candidate, job): active duplicates are rejected; withdrawn/rejected
 * rows can be reopened onto the pipeline.
 */
export async function sourceCandidateAction(input: {
  candidateId: string;
  jobOrderId: string;
  reopenIfClosed?: boolean;
}): Promise<SourceActionResult> {
  const session = await requireRecruiter();
  if (!session) return { ok: false, error: "Not authorized." };

  const candidateId = input.candidateId?.trim();
  const jobOrderId = input.jobOrderId?.trim();
  if (!candidateId || !jobOrderId) {
    return { ok: false, error: "Candidate and job are required." };
  }

  const supabase = createClient();
  const scopedOrgs = memberOrgIds(session.memberships);
  if (scopedOrgs.length === 0) {
    return { ok: false, error: "No organization membership found." };
  }

  // Confirm discoverable (or already engaged with our org) via projection RPC.
  const { data: projected, error: projErr } = await supabase.rpc("project_searchable_candidate", {
    p_candidate: candidateId,
  });
  if (projErr) {
    return { ok: false, error: projErr.message };
  }
  const discovery = (projected as { candidate_id: string }[] | null)?.[0];
  if (!discovery) {
    return {
      ok: false,
      error: "Candidate is not discoverable or has not approved search fields.",
    };
  }

  const { data: jobData, error: jobErr } = await supabase
    .from("job_orders")
    .select("*")
    .eq("id", jobOrderId)
    .maybeSingle();
  if (jobErr) return { ok: false, error: jobErr.message };
  const job = jobData as JobOrderRow | null;
  if (!job) return { ok: false, error: "Job order not found." };
  if (!["active", "approved", "on_hold"].includes(job.status)) {
    return { ok: false, error: "This job is not open for sourcing." };
  }
  if (!scopedOrgs.includes(job.responsible_org_id)) {
    return { ok: false, error: "You cannot source candidates onto this job." };
  }

  const { data: existingData } = await supabase
    .from("applications")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("job_order_id", jobOrderId)
    .maybeSingle();
  const existing = existingData as ApplicationRow | null;

  if (existing && !existing.withdrawn_at && existing.current_stage !== "rejected") {
    return {
      ok: false,
      duplicate: true,
      applicationId: existing.id,
      error: "This candidate already has an active application for that job.",
    };
  }

  if (existing && (existing.withdrawn_at || existing.current_stage === "rejected")) {
    if (!input.reopenIfClosed) {
      return {
        ok: false,
        duplicate: true,
        applicationId: existing.id,
        error: existing.withdrawn_at
          ? "A withdrawn application exists for this job. Confirm to reopen it as sourced."
          : "A rejected application exists for this job. Confirm to reopen it as sourced.",
      };
    }

    const before = {
      stage: existing.current_stage,
      withdrawn_at: existing.withdrawn_at,
      entry_source: existing.entry_source,
    };
    const { error: updErr } = await supabase
      .from("applications")
      .update({
        withdrawn_at: null,
        current_stage: "cv_review",
        entry_source: "recruiter_sourced",
        is_direct_application: false,
        sourced_contact_status: "not_contacted",
        sourced_contacted_at: null,
        assigned_recruiter_id: session.userId,
        consent_status: "pending",
        rejected_from_stage: null,
        rejected_at: null,
        rejection_reason: null,
      })
      .eq("id", existing.id);
    if (updErr) return { ok: false, error: updErr.message };

    await supabase.from("application_stage_history").insert({
      application_id: existing.id,
      from_stage: existing.current_stage,
      to_stage: "cv_review",
      actor_id: session.userId,
      actor_role: "recruiter",
      note: "Reopened as recruiter-sourced",
      source: "recruiter_sourced",
    });
    await writeAudit(
      "application.sourced_reopened",
      "application",
      existing.id,
      existing.owning_org_id,
      before,
      { stage: "cv_review", entry_source: "recruiter_sourced" },
    );

    revalidatePath("/recruiter/candidates");
    revalidatePath(`/recruiter/candidates/${candidateId}`);
    revalidatePath("/recruiter/pipeline");
    revalidatePath(`/recruiter/applications/${existing.id}`);
    return { ok: true, applicationId: existing.id, reopened: true };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("applications")
    .insert({
      candidate_id: candidateId,
      job_order_id: jobOrderId,
      owning_org_id: job.responsible_org_id,
      recruitment_path: job.recruitment_path,
      entry_source: "recruiter_sourced",
      is_direct_application: false,
      sourced_contact_status: "not_contacted",
      current_stage: "cv_review",
      consent_status: "pending",
      assigned_recruiter_id: session.userId,
    })
    .select("id")
    .single();

  if (insErr) {
    // Unique violation → race with another insert
    if (insErr.code === "23505") {
      const { data: raced } = await supabase
        .from("applications")
        .select("id")
        .eq("candidate_id", candidateId)
        .eq("job_order_id", jobOrderId)
        .maybeSingle();
      return {
        ok: false,
        duplicate: true,
        applicationId: (raced as { id: string } | null)?.id,
        error: "This candidate already has an application for that job.",
      };
    }
    return { ok: false, error: insErr.message };
  }

  const applicationId = (inserted as { id: string }).id;
  await supabase.from("application_stage_history").insert({
    application_id: applicationId,
    from_stage: null,
    to_stage: "cv_review",
    actor_id: session.userId,
    actor_role: "recruiter",
    note: "Sourced – not yet contacted",
    source: "recruiter_sourced",
  });
  await writeAudit(
    "application.sourced",
    "application",
    applicationId,
    job.responsible_org_id,
    null,
    {
      candidate_id: candidateId,
      job_order_id: jobOrderId,
      sourced_contact_status: "not_contacted",
    },
  );

  revalidatePath("/recruiter/candidates");
  revalidatePath(`/recruiter/candidates/${candidateId}`);
  revalidatePath("/recruiter/pipeline");
  revalidatePath(`/recruiter/applications/${applicationId}`);
  return { ok: true, applicationId };
}

const CONTACT_KEYS = new Set(SOURCED_CONTACT_STATUSES.map((s) => s.key));

/** Update sourced-contact disposition on a recruiter-sourced application. */
export async function updateSourcedContactStatusAction(input: {
  applicationId: string;
  status: SourcedContactStatusKey;
}): Promise<SourceActionResult> {
  const session = await requireRecruiter();
  if (!session) return { ok: false, error: "Not authorized." };
  if (!CONTACT_KEYS.has(input.status)) {
    return { ok: false, error: "Invalid contact status." };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("id", input.applicationId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const app = data as ApplicationRow | null;
  if (!app) return { ok: false, error: "Application not found." };

  if (app.is_direct_application && app.entry_source !== "recruiter_sourced") {
    return { ok: false, error: "Contact status applies only to sourced applications." };
  }

  const patch: Partial<ApplicationRow> = {
    sourced_contact_status: input.status,
  };
  if (input.status !== "not_contacted" && !app.sourced_contacted_at) {
    patch.sourced_contacted_at = new Date().toISOString();
  }
  if (input.status === "not_contacted") {
    patch.sourced_contacted_at = null;
  }

  const { error: updErr } = await supabase.from("applications").update(patch).eq("id", app.id);
  if (updErr) return { ok: false, error: updErr.message };

  await writeAudit(
    "application.sourced_contact_updated",
    "application",
    app.id,
    app.owning_org_id ?? primaryOrgId(session.memberships),
    { sourced_contact_status: app.sourced_contact_status },
    { sourced_contact_status: input.status },
  );

  revalidatePath(`/recruiter/applications/${app.id}`);
  revalidatePath("/recruiter/pipeline");
  revalidatePath(`/recruiter/candidates/${app.candidate_id}`);
  return { ok: true, applicationId: app.id };
}
