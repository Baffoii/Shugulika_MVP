"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { EMPLOYER_REJECTION_CATEGORIES } from "@/lib/constants";
import { employerDecisionCtaUrl, sendEmployerDecisionEmail } from "@/lib/email/send";
import { getOrganizationName } from "@/lib/data/employer-applications";
import type { EmployerApplicationRow, Json, ProfileRow } from "@/lib/database.types";

export interface ReviewActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/**
 * Reviewer server actions. Fine-grained authorization (assignment + geographic
 * scope) lives in the SECURITY DEFINER RPCs and RLS — these actions only gate
 * the obvious role requirement and translate errors for the UI.
 */
async function requireReviewerRole(): Promise<ReviewActionResult | null> {
  const ctx = await requireSession();
  const canReview = ctx.roles.some((r) => r === "hq_admin" || r === "franchise_admin");
  if (!canReview) {
    return { ok: false, error: "You do not have permission to review employer applications." };
  }
  return null;
}

function revalidateReviewPaths(applicationId: string) {
  for (const path of [
    "/hq/employer-applications",
    `/hq/employer-applications/${applicationId}`,
    "/franchise/employer-applications",
    `/franchise/employer-applications/${applicationId}`,
    "/hq/audit-log",
    "/onboarding/employer",
  ]) {
    revalidatePath(path);
  }
}

async function loadApplicationForEmail(
  applicationId: string,
): Promise<{ app: EmployerApplicationRow; applicantEmail: string } | null> {
  const supabase = createClient();
  const { data: app } = await supabase
    .from("employer_applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app) return null;
  const row = app as EmployerApplicationRow;
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", row.applicant_user_id)
    .maybeSingle();
  const email = ((profile as Pick<ProfileRow, "email"> | null)?.email ?? "").trim();
  if (!email) return null;
  return { app: row, applicantEmail: email };
}

/** Best-effort; never blocks the reviewer action. */
async function notifyEmployerChangesRequested(
  applicationId: string,
  explanation: string,
  changes: { field?: string; instruction: string }[],
) {
  const loaded = await loadApplicationForEmail(applicationId);
  if (!loaded) return;
  await sendEmployerDecisionEmail({
    to: loaded.applicantEmail,
    kind: "changes_requested",
    payload: {
      companyName: loaded.app.legal_name ?? "your company",
      explanation,
      changes,
      ctaUrl: employerDecisionCtaUrl("/onboarding/employer"),
    },
  });
}

/** Best-effort; never blocks the reviewer action. */
async function notifyEmployerApproved(applicationId: string) {
  const loaded = await loadApplicationForEmail(applicationId);
  if (!loaded) return;
  const officeName = (await getOrganizationName(loaded.app.assigned_org_id)) ?? "Shugulika HQ";
  await sendEmployerDecisionEmail({
    to: loaded.applicantEmail,
    kind: "approved",
    payload: {
      companyName: loaded.app.legal_name ?? "Your company",
      officeName,
      ctaUrl: employerDecisionCtaUrl("/employer/dashboard"),
    },
  });
}

export async function openEmployerApplicationReviewAction(
  applicationId: string,
): Promise<ReviewActionResult> {
  const denied = await requireReviewerRole();
  if (denied) return denied;
  const supabase = createClient();
  const { error } = await supabase.rpc("open_employer_application_review", {
    p_application_id: applicationId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateReviewPaths(applicationId);
  return { ok: true, message: "Application moved to under review." };
}

export async function approveEmployerApplicationAction(
  applicationId: string,
): Promise<ReviewActionResult> {
  const denied = await requireReviewerRole();
  if (denied) return denied;
  const supabase = createClient();
  const { error } = await supabase.rpc("approve_employer_application", {
    p_application_id: applicationId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateReviewPaths(applicationId);
  await notifyEmployerApproved(applicationId);
  return { ok: true, message: "Company approved and activated." };
}

export async function requestEmployerApplicationChangesAction(
  applicationId: string,
  message: string,
  changes: { field?: string; instruction: string }[],
): Promise<ReviewActionResult> {
  const denied = await requireReviewerRole();
  if (denied) return denied;
  const trimmed = message.trim();
  if (trimmed.length < 8) {
    return { ok: false, error: "Provide a general explanation (at least 8 characters)." };
  }
  const cleaned = changes
    .map((c) => ({ field: c.field?.trim() || undefined, instruction: c.instruction.trim() }))
    .filter((c) => c.instruction.length > 0);
  if (cleaned.length === 0) {
    return { ok: false, error: "List at least one actionable required change." };
  }
  const supabase = createClient();
  const { error } = await supabase.rpc("request_employer_application_changes", {
    p_application_id: applicationId,
    p_message: trimmed,
    p_changes: cleaned as unknown as Json,
  });
  if (error) return { ok: false, error: error.message };
  revalidateReviewPaths(applicationId);
  await notifyEmployerChangesRequested(applicationId, trimmed, cleaned);
  return { ok: true, message: "Application returned to the employer for changes." };
}

export async function rejectEmployerApplicationAction(
  applicationId: string,
  category: string,
  reason: string,
  reapplyAllowed: boolean,
  internalNote?: string,
): Promise<ReviewActionResult> {
  const denied = await requireReviewerRole();
  if (denied) return denied;
  if (!EMPLOYER_REJECTION_CATEGORIES.some((c) => c.key === category)) {
    return { ok: false, error: "Choose a rejection category." };
  }
  if (reason.trim().length < 8) {
    return { ok: false, error: "Provide an employer-facing reason (at least 8 characters)." };
  }
  const supabase = createClient();
  const { error } = await supabase.rpc("reject_employer_application", {
    p_application_id: applicationId,
    p_category: category,
    p_reason: reason.trim(),
    p_reapply_allowed: reapplyAllowed,
    p_internal_note: internalNote?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidateReviewPaths(applicationId);
  return { ok: true, message: "Application rejected." };
}

/** HQ only (enforced again inside the RPC). Pass null to route to the HQ queue. */
export async function reassignEmployerApplicationAction(
  applicationId: string,
  orgId: string | null,
): Promise<ReviewActionResult> {
  const ctx = await requireSession();
  if (!ctx.roles.includes("hq_admin")) {
    return { ok: false, error: "Only HQ can assign or reassign applications." };
  }
  const supabase = createClient();
  const { error } = await supabase.rpc("reassign_employer_application", {
    p_application_id: applicationId,
    p_org_id: orgId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateReviewPaths(applicationId);
  return {
    ok: true,
    message: orgId ? "Application assigned." : "Application moved to the HQ queue.",
  };
}

export async function addEmployerApplicationNoteAction(
  applicationId: string,
  note: string,
): Promise<ReviewActionResult> {
  const denied = await requireReviewerRole();
  if (denied) return denied;
  if (note.trim().length < 2) return { ok: false, error: "Enter a note." };
  const supabase = createClient();
  const { error } = await supabase.rpc("add_employer_application_note", {
    p_application_id: applicationId,
    p_note: note.trim(),
  });
  if (error) return { ok: false, error: error.message };
  revalidateReviewPaths(applicationId);
  return { ok: true, message: "Internal note added." };
}
