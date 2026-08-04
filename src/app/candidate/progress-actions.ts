"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/candidate/actions";
import type { CandidateHelpRequestType } from "@/lib/candidate/constants";

function candidateDb(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

export async function shareAssessmentResultAction(input: {
  assignmentId: string;
  purpose: string;
  expiresAt?: string | null;
}): Promise<ActionResult> {
  const purpose = input.purpose.trim();
  if (purpose.length < 3 || purpose.length > 240) {
    return { ok: false, error: "Explain why you are sharing this result." };
  }
  const expiresAt = input.expiresAt?.trim() || null;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    return { ok: false, error: "Choose a future expiry date." };
  }
  const { error } = await candidateDb().rpc("candidate_share_assessment_result", {
    p_assignment_id: input.assignmentId,
    p_purpose: purpose,
    p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/candidate/assessments/${input.assignmentId}/result`);
  revalidatePath("/candidate/assessments");
  revalidatePath("/candidate/dashboard");
  return { ok: true, message: "Result shared through the secure portal." };
}

export async function revokeAssessmentResultShareAction(
  grantId: string,
  assignmentId: string,
): Promise<ActionResult> {
  const { error } = await candidateDb().rpc("candidate_revoke_result_share", {
    p_grant_id: grantId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/candidate/assessments/${assignmentId}/result`);
  revalidatePath("/candidate/dashboard");
  return { ok: true, message: "Result share revoked." };
}

export async function shareCvAction(
  applicationId: string,
  documentId: string,
): Promise<ActionResult> {
  const { error } = await candidateDb().rpc("candidate_share_cv", {
    p_application_id: applicationId,
    p_document_id: documentId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/applications");
  revalidatePath(`/candidate/applications/${applicationId}`);
  revalidatePath("/candidate/dashboard");
  return {
    ok: true,
    message: "CV shared by secure portal link. No document was attached to WhatsApp.",
  };
}

export async function requestCandidateSupportAction(input: {
  requestType: CandidateHelpRequestType;
  subjectType: "candidate" | "application" | "assessment" | "interview";
  subjectId: string;
  message: string;
}): Promise<ActionResult> {
  const message = input.message.trim();
  if (message.length < 10 || message.length > 2000) {
    return { ok: false, error: "Please enter between 10 and 2,000 characters." };
  }
  const { error } = await candidateDb().rpc("candidate_request_support", {
    p_request_type: input.requestType,
    p_subject_type: input.subjectType,
    p_subject_id: input.subjectId,
    p_message: message,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/help");
  revalidatePath("/candidate/dashboard");
  return {
    ok: true,
    message:
      input.requestType === "duplicate_review"
        ? "Your duplicate account review request was sent to staff. No accounts were merged automatically."
        : "Your request was sent to the hiring team.",
  };
}
