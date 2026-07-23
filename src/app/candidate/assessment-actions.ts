"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyCandidate } from "@/lib/data/candidate";
import type { AssessmentAssignmentRow } from "@/lib/database.types";
import {
  gradeShugulikaAssessment,
  type StoredAssessmentResponses,
} from "@/lib/assessments/grade-shugulika";
import { getCandidateQuestions } from "@/lib/assessments/question-banks";
import type { AssessmentSeniority } from "@/lib/assessments/question-bank-types";

export interface AssessmentActionResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

async function loadOwnAssignment(assignmentId: string): Promise<AssessmentAssignmentRow | null> {
  const candidate = await getMyCandidate();
  if (!candidate) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from("assessment_assignments")
    .select("*")
    .eq("id", assignmentId)
    .eq("candidate_id", candidate.id)
    .maybeSingle();
  return (data as AssessmentAssignmentRow | null) ?? null;
}

export async function openAssessmentAction(assignmentId: string): Promise<AssessmentActionResult> {
  const assignment = await loadOwnAssignment(assignmentId);
  if (!assignment) return { ok: false, error: "Assessment not found." };
  if (["submitted", "graded", "cancelled", "expired"].includes(assignment.status)) {
    return { ok: false, error: "This assessment is no longer open." };
  }
  if (assignment.due_at && new Date(assignment.due_at).getTime() < Date.now()) {
    return { ok: false, error: "This assessment deadline has passed." };
  }

  const nextStatus = assignment.status === "assigned" ? "opened" : "in_progress";
  const supabase = createClient();
  const patch: Record<string, unknown> = { status: nextStatus };
  if (!assignment.opened_at) patch.opened_at = new Date().toISOString();

  const { error } = await supabase
    .from("assessment_assignments")
    .update(patch)
    .eq("id", assignment.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/candidate/assessments");
  revalidatePath(`/candidate/assessments/${assignment.id}`);
  return { ok: true };
}

/** Employer-provided only (or dual employer portion): mark submitted without in-app grading. */
export async function submitEmployerAssessmentAction(
  assignmentId: string,
): Promise<AssessmentActionResult> {
  const assignment = await loadOwnAssignment(assignmentId);
  if (!assignment) return { ok: false, error: "Assessment not found." };
  if (!["assigned", "opened", "in_progress"].includes(assignment.status)) {
    return { ok: false, error: "This assessment cannot be submitted." };
  }
  if (assignment.assessment_mode === "shugulika") {
    return {
      ok: false,
      error: "Use the Shugulika assessment form to submit your answers.",
    };
  }
  if (assignment.due_at && new Date(assignment.due_at).getTime() < Date.now()) {
    return { ok: false, error: "This assessment deadline has passed." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("assessment_assignments")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      opened_at: assignment.opened_at ?? new Date().toISOString(),
    })
    .eq("id", assignment.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/candidate/assessments");
  revalidatePath(`/candidate/assessments/${assignment.id}`);
  return { ok: true };
}

export async function submitShugulikaAssessmentAction(
  assignmentId: string,
  formData: FormData,
): Promise<AssessmentActionResult> {
  const assignment = await loadOwnAssignment(assignmentId);
  if (!assignment) return { ok: false, error: "Assessment not found." };
  if (!["assigned", "opened", "in_progress"].includes(assignment.status)) {
    return { ok: false, error: "This assessment cannot be submitted." };
  }
  if (assignment.assessment_mode === "employer") {
    return {
      ok: false,
      error: "This assignment is employer-provided only.",
    };
  }
  if (assignment.due_at && new Date(assignment.due_at).getTime() < Date.now()) {
    return { ok: false, error: "This assessment deadline has passed." };
  }

  const seniority = assignment.assessment_seniority as AssessmentSeniority;
  const questions = getCandidateQuestions(seniority);
  const mcq: StoredAssessmentResponses["mcq"] = [];
  const freeResponse: StoredAssessmentResponses["freeResponse"] = [];

  for (const question of questions) {
    if (question.kind === "mcq") {
      const selected = String(formData.get(`mcq_${question.id}`) ?? "").trim();
      if (!selected) {
        return { ok: false, error: `Please answer: ${question.prompt.slice(0, 80)}…` };
      }
      mcq.push({ questionId: question.id, selectedChoiceIds: [selected] });
    } else {
      const text = String(formData.get(`fr_${question.id}`) ?? "").trim();
      if (text.length < 40) {
        return {
          ok: false,
          error: `Please write a fuller answer for: ${question.prompt.slice(0, 80)}…`,
        };
      }
      freeResponse.push({ questionId: question.id, text });
    }
  }

  const responses: StoredAssessmentResponses = { mcq, freeResponse };
  const passThreshold =
    assignment.pass_threshold ?? (assignment.assessment_seniority === "senior" ? 65 : 65);

  let grade;
  try {
    grade = await gradeShugulikaAssessment({
      seniority,
      responses,
      passThresholdPercent: Number(passThreshold),
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not grade the assessment. Try again or contact your recruiter.",
    };
  }

  const supabase = createClient();
  // Move to submitted with responses first (candidate RLS), then apply grade via RPC.
  const { error: saveError } = await supabase
    .from("assessment_assignments")
    .update({
      status: "submitted",
      responses: responses as never,
      submitted_at: new Date().toISOString(),
      opened_at: assignment.opened_at ?? new Date().toISOString(),
    })
    .eq("id", assignment.id);
  if (saveError) return { ok: false, error: saveError.message };

  const { error: gradeError } = await supabase.rpc("apply_assessment_grade", {
    p_assignment_id: assignment.id,
    p_responses: responses as never,
    p_score: grade.scorePercent,
    p_mcq_score: grade.mcqScorePercent,
    p_free_response_score: grade.freeResponseScorePercent,
    p_result_band: grade.resultBand,
    p_human_review_required: grade.humanReviewRequired,
    p_ai_confidence: grade.aiConfidence,
    p_grading_payload: grade.gradingPayload as never,
    p_grading_notes: grade.gradingNotes,
  });
  if (gradeError) {
    return {
      ok: true,
      warning: `Answers saved, but grading finalize failed: ${gradeError.message}`,
    };
  }

  revalidatePath("/candidate/assessments");
  revalidatePath(`/candidate/assessments/${assignment.id}`);
  return { ok: true };
}
