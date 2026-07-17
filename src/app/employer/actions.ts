"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { EmployerSubmissionRow } from "@/lib/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function actor(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

const ALLOWED = ["viewed", "shortlisted", "interview_requested", "rejected"] as const;

/** Employer decision on a submission (masked candidate). Records the decision,
 *  audits it, and notifies the submitting recruiter's workflow via activity. */
export async function decideSubmissionAction(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const submissionId = String(formData.get("submission_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!ALLOWED.includes(decision as (typeof ALLOWED)[number]))
    return { ok: false, error: "Invalid decision." };
  if (decision === "rejected" && !reason)
    return { ok: false, error: "A rejection reason is required." };

  const { data: subData } = await supabase
    .from("employer_submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();
  const sub = subData as EmployerSubmissionRow | null;
  if (!sub) return { ok: false, error: "Not found or not authorized." };

  const { error } = await supabase
    .from("employer_submissions")
    .update({ status: decision })
    .eq("id", submissionId);
  if (error) return { ok: false, error: error.message };

  const actorId = await actor();
  await supabase.from("audit_logs").insert({
    actor_id: actorId,
    action: `submission.${decision}`,
    entity_type: "employer_submission",
    entity_id: submissionId,
    org_context_id: sub.employer_org_id,
    before_value: { status: sub.status } as never,
    after_value: { status: decision, reason: reason || null } as never,
  });
  await supabase.from("activity_events").insert({
    owning_org_id: sub.submitting_org_id,
    subject_type: "employer_submission",
    subject_id: submissionId,
    event_type: `employer_${decision}`,
    actor_id: actorId,
    summary: reason || `Employer marked ${decision}`,
  });

  revalidatePath(`/employer/submissions/${submissionId}`);
  revalidatePath("/employer/submissions");
  return { ok: true };
}

export async function addEmployerCommentAction(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const submissionId = String(formData.get("submission_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { ok: false, error: "Comment cannot be empty." };
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("employer_comments")
    .insert({ submission_id: submissionId, author_id: actorId, body });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/employer/submissions/${submissionId}`);
  return { ok: true };
}
