"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  stageByKey,
  CANDIDATE_FACING_STATUS,
  REJECTION_REASONS,
  allowedNextStages,
} from "@/lib/constants";
import type {
  ApplicationRow,
  AssessmentAssignmentRow,
  CandidateProfileRow,
  JobOrderRow,
  Json,
} from "@/lib/database.types";
import { getQuestionBank } from "@/lib/assessments/question-banks";
import type {
  AssessmentSeniority,
  BankFreeResponseQuestion,
} from "@/lib/assessments/question-bank-types";
import {
  gradeShugulikaAssessment,
  type StoredAssessmentResponses,
} from "@/lib/assessments/grade-shugulika";
import { isOpenAiConfigured } from "@/lib/env";

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

  // Entering Testing delivers the aptitude assignment so candidates can open it
  // under Assessments. Recruiters can still use "Send assessment" as a recovery
  // path if delivery failed earlier.
  let assessmentWarning: string | undefined;
  if (toStage === "testing") {
    const assigned = await assignAssessmentForApplication({ ...app, current_stage: "testing" });
    if (!assigned.ok) {
      assessmentWarning = assigned.error ?? "Could not deliver the aptitude assessment.";
    } else if (
      assigned.warning &&
      !assigned.warning.startsWith("This assessment has already been assigned")
    ) {
      assessmentWarning = assigned.warning;
    }
  }

  const notify = await notifyCandidateStatus(app, toStage);
  revalidateApplicationPaths(app.id);
  revalidatePath("/candidate/assessments");
  if (!notify.ok) {
    return {
      ok: true,
      warning: [assessmentWarning, notify.error].filter(Boolean).join(" "),
    };
  }
  return assessmentWarning ? { ok: true, warning: assessmentWarning } : { ok: true };
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
  let testScore = String(formData.get("test_score") ?? "").trim();
  const app = await loadApplication(applicationId);
  if (!app) return { ok: false, error: "Application not found or not authorized." };
  if (app.current_stage !== "testing") {
    return {
      ok: false,
      error: "Testing can only be marked submitted while the candidate is in Testing.",
    };
  }

  const supabase = createClient();
  if (!testScore) {
    const { data: assignmentData } = await supabase
      .from("assessment_assignments")
      .select("score,status")
      .eq("application_id", app.id)
      .maybeSingle();
    const assignment = assignmentData as { score: number | null; status: string } | null;
    if (assignment?.score != null && assignment.status === "graded") {
      testScore = String(assignment.score);
    }
  }

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

/** Create the aptitude assignment for an application already in Testing. */
async function assignAssessmentForApplication(app: ApplicationRow): Promise<ActionResult> {
  if (app.current_stage !== "testing") {
    return { ok: false, error: "Move the candidate to Testing before assigning an assessment." };
  }

  const supabase = createClient();
  const [{ data: jobData }, { data: existing }] = await Promise.all([
    supabase.from("job_orders").select("*").eq("id", app.job_order_id).maybeSingle(),
    supabase
      .from("assessment_assignments")
      .select("id,status")
      .eq("application_id", app.id)
      .maybeSingle(),
  ]);
  const job = jobData as JobOrderRow | null;
  if (!job) return { ok: false, error: "The job-order assessment could not be loaded." };
  if (existing) return { ok: true, warning: "This assessment has already been assigned." };

  const actorId = await actor();
  if (!actorId) return { ok: false, error: "Not signed in." };
  const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: inserted, error } = await supabase
    .from("assessment_assignments")
    .insert({
      application_id: app.id,
      job_order_id: app.job_order_id,
      candidate_id: app.candidate_id,
      assessment_mode: job.assessment_mode,
      assessment_seniority: job.assessment_seniority,
      pass_threshold: job.assessment_pass_threshold,
      assigned_by: actorId,
      due_at: dueAt,
      status: "assigned",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const assignmentId = (inserted as { id: string }).id;
  const { error: notifyError } = await supabase.rpc("notify_candidate_of_assessment_assignment", {
    p_assignment_id: assignmentId,
    p_title: "Aptitude assessment assigned",
    p_body: `Complete the ${job.assessment_seniority} assessment for ${job.title} within 7 days. Open Assessments to start.`,
  });
  await writeAudit("assessment.assigned", app.id, app.owning_org_id, null, {
    assessment_assignment_id: assignmentId,
    mode: job.assessment_mode,
    seniority: job.assessment_seniority,
    due_at: dueAt,
    pass_threshold: job.assessment_pass_threshold,
  });
  revalidatePath(`/recruiter/applications/${app.id}`);
  revalidatePath("/candidate/assessments");
  revalidatePath("/candidate/notifications");
  if (notifyError) {
    return {
      ok: true,
      warning: `Assessment assigned, but the candidate notification failed: ${notifyError.message}`,
    };
  }
  return { ok: true };
}

/** Send (or re-deliver) the job's assessment to a candidate already in Testing. */
export async function assignAssessmentAction(formData: FormData): Promise<ActionResult> {
  const applicationId = String(formData.get("application_id") ?? "");
  const app = await loadApplication(applicationId);
  if (!app) return { ok: false, error: "Application not found or not authorized." };
  return assignAssessmentForApplication(app);
}

function parseStoredResponses(value: Json): StoredAssessmentResponses | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const mcqRaw = Array.isArray(root.mcq) ? root.mcq : [];
  const frRaw = Array.isArray(root.freeResponse) ? root.freeResponse : [];
  const mcq: StoredAssessmentResponses["mcq"] = [];
  const freeResponse: StoredAssessmentResponses["freeResponse"] = [];
  for (const item of mcqRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.questionId !== "string") continue;
    const selected = Array.isArray(row.selectedChoiceIds)
      ? row.selectedChoiceIds.filter((id): id is string => typeof id === "string")
      : [];
    mcq.push({ questionId: row.questionId, selectedChoiceIds: selected });
  }
  for (const item of frRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.questionId !== "string") continue;
    freeResponse.push({
      questionId: row.questionId,
      text: typeof row.text === "string" ? row.text : "",
    });
  }
  if (mcq.length === 0 && freeResponse.length === 0) return null;
  return { mcq, freeResponse };
}

async function syncPipelineTestScore(
  applicationId: string,
  scorePercent: number,
): Promise<string | null> {
  const app = await loadApplication(applicationId);
  if (!app) return "Application not found while syncing Test score.";
  const supabase = createClient();
  const { error } = await supabase
    .from("applications")
    .update({
      test_name: app.test_name?.trim() || "Skills assessment",
      test_score: String(scorePercent),
    })
    .eq("id", app.id);
  return error?.message ?? null;
}

/**
 * Re-run OpenAI free-response grading on stored answers (e.g. after enabling
 * OPENAI_API_KEY, or to refresh explanations). MCQs stay deterministic.
 */
export async function regradeAssessmentWithAiAction(formData: FormData): Promise<ActionResult> {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  if (!assignmentId) return { ok: false, error: "Assignment id is required." };
  if (!isOpenAiConfigured()) {
    return {
      ok: false,
      error: "OpenAI is not configured. Set OPENAI_API_KEY on the server and retry.",
    };
  }

  const supabase = createClient();
  const { data: assignmentData } = await supabase
    .from("assessment_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  const assignment = assignmentData as AssessmentAssignmentRow | null;
  if (!assignment) {
    return { ok: false, error: "Assessment assignment not found or not authorized." };
  }
  if (!["submitted", "graded"].includes(assignment.status)) {
    return { ok: false, error: "Only submitted or graded assessments can be re-graded." };
  }
  if (assignment.assessment_mode === "employer") {
    return {
      ok: false,
      error: "Employer-only assignments have no Shugulika free-response grading.",
    };
  }

  const responses = parseStoredResponses(assignment.responses);
  if (!responses?.freeResponse.length) {
    return { ok: false, error: "No free-response answers are stored for this assignment." };
  }

  const seniority = assignment.assessment_seniority as AssessmentSeniority;
  const bank = getQuestionBank(seniority);
  const passThreshold = Number(assignment.pass_threshold ?? bank.passThresholdPercent);

  let grade;
  try {
    grade = await gradeShugulikaAssessment({
      seniority,
      responses,
      passThresholdPercent: passThreshold,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "AI re-grade failed.",
    };
  }

  const actorId = await actor();
  const { error } = await supabase
    .from("assessment_assignments")
    .update({
      status: grade.humanReviewRequired ? "submitted" : "graded",
      score: grade.scorePercent,
      mcq_score: grade.mcqScorePercent,
      free_response_score: grade.freeResponseScorePercent,
      result_band: grade.resultBand,
      human_review_required: grade.humanReviewRequired,
      ai_confidence: grade.aiConfidence,
      grading_payload: grade.gradingPayload as never,
      grading_notes: grade.humanReviewRequired
        ? grade.gradingNotes
        : `AI free-response re-grade completed. Overall ${grade.scorePercent}% (${grade.resultBand}).`,
      grader_id: grade.humanReviewRequired ? null : actorId,
      graded_at: grade.humanReviewRequired ? null : new Date().toISOString(),
    })
    .eq("id", assignment.id);
  if (error) return { ok: false, error: error.message };

  let warning: string | undefined;
  if (!grade.humanReviewRequired) {
    const syncError = await syncPipelineTestScore(assignment.application_id, grade.scorePercent);
    if (syncError)
      warning = `AI grades saved, but the pipeline Test score could not be updated: ${syncError}`;
  }

  await writeAudit(
    "assessment.ai_regraded",
    assignment.application_id,
    (await loadApplication(assignment.application_id))?.owning_org_id ?? null,
    {
      score: assignment.score,
      result_band: assignment.result_band,
      human_review_required: assignment.human_review_required,
    },
    {
      score: grade.scorePercent,
      result_band: grade.resultBand,
      human_review_required: grade.humanReviewRequired,
      free_response_score: grade.freeResponseScorePercent,
    },
  );

  revalidatePath(`/recruiter/applications/${assignment.application_id}`);
  revalidatePath("/candidate/assessments");
  revalidatePath(`/candidate/assessments/${assignment.id}`);
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * Accept existing AI free-response scores without retyping (clears human-review hold).
 */
export async function acceptAiAssessmentGradesAction(formData: FormData): Promise<ActionResult> {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  if (!assignmentId) return { ok: false, error: "Assignment id is required." };

  const supabase = createClient();
  const { data: assignmentData } = await supabase
    .from("assessment_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  const assignment = assignmentData as AssessmentAssignmentRow | null;
  if (!assignment) {
    return { ok: false, error: "Assessment assignment not found or not authorized." };
  }
  if (!assignment.human_review_required && assignment.status === "graded") {
    return { ok: true };
  }

  const payload =
    assignment.grading_payload &&
    typeof assignment.grading_payload === "object" &&
    !Array.isArray(assignment.grading_payload)
      ? ({ ...(assignment.grading_payload as Record<string, unknown>) } as Record<string, unknown>)
      : null;
  if (!payload) return { ok: false, error: "No AI grading payload to accept." };

  const freeResponse =
    payload.freeResponse &&
    typeof payload.freeResponse === "object" &&
    !Array.isArray(payload.freeResponse)
      ? (payload.freeResponse as Record<string, unknown>)
      : null;
  const results = Array.isArray(freeResponse?.results) ? freeResponse.results : [];
  if (results.length === 0) return { ok: false, error: "No AI free-response scores to accept." };

  const hasAiScores = results.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const model = (item as { model?: string }).model;
    return typeof model === "string" && model !== "none";
  });
  if (!hasAiScores) {
    return {
      ok: false,
      error: "AI has not graded these answers yet. Use “Re-grade with AI” first.",
    };
  }

  const seniority = assignment.assessment_seniority as AssessmentSeniority;
  const bank = getQuestionBank(seniority);
  const mcq =
    payload.mcq && typeof payload.mcq === "object" && !Array.isArray(payload.mcq)
      ? (payload.mcq as { pointsAwarded?: number; pointsPossible?: number })
      : {};
  const mcqAwarded = typeof mcq.pointsAwarded === "number" ? mcq.pointsAwarded : 0;
  const mcqPossible = typeof mcq.pointsPossible === "number" ? mcq.pointsPossible : 0;
  let frAwarded = 0;
  let frPossible = 0;
  for (const item of results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as { score?: number; maxScore?: number };
    if (typeof row.score === "number") frAwarded += row.score;
    if (typeof row.maxScore === "number") frPossible += row.maxScore;
  }
  const pointsPossible = mcqPossible + frPossible;
  const pointsAwarded = mcqAwarded + frAwarded;
  const scorePercent =
    pointsPossible === 0 ? 0 : Math.round((pointsAwarded / pointsPossible) * 10000) / 100;
  const freeResponseScorePercent =
    frPossible === 0 ? null : Math.round((frAwarded / frPossible) * 10000) / 100;
  const passThreshold = Number(assignment.pass_threshold ?? bank.passThresholdPercent);
  const resultBand: "pass" | "fail" = scorePercent >= passThreshold ? "pass" : "fail";
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "Not signed in." };

  const nextResults = results.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return {
      ...(item as Record<string, unknown>),
      humanReviewRequired: false,
      acceptedBy: actorId,
      acceptedAt: new Date().toISOString(),
    };
  });

  const nextPayload = {
    ...payload,
    freeResponse: {
      ...(freeResponse ?? {}),
      version: 1,
      kind: "free_response",
      humanReviewRequired: false,
      results: nextResults,
      recruiterReview: {
        reviewedBy: actorId,
        reviewedAt: new Date().toISOString(),
        notes: "Accepted AI free-response grades.",
        acceptedAi: true,
      },
    },
    scorePercent,
    passThresholdPercent: passThreshold,
    humanReviewCompleted: true,
  } as Json;

  const { error } = await supabase
    .from("assessment_assignments")
    .update({
      status: "graded",
      score: scorePercent,
      free_response_score: freeResponseScorePercent,
      result_band: resultBand,
      human_review_required: false,
      grading_payload: nextPayload,
      grading_notes: `Recruiter accepted AI free-response grades. Overall ${scorePercent}% (${resultBand}).`,
      grader_id: actorId,
      graded_at: new Date().toISOString(),
    })
    .eq("id", assignment.id);
  if (error) return { ok: false, error: error.message };

  const syncError = await syncPipelineTestScore(assignment.application_id, scorePercent);
  await writeAudit(
    "assessment.ai_grades_accepted",
    assignment.application_id,
    (await loadApplication(assignment.application_id))?.owning_org_id ?? null,
    {
      score: assignment.score,
      result_band: assignment.result_band,
      human_review_required: assignment.human_review_required,
    },
    {
      score: scorePercent,
      result_band: resultBand,
      human_review_required: false,
      free_response_score: freeResponseScorePercent,
    },
  );

  revalidatePath(`/recruiter/applications/${assignment.application_id}`);
  revalidatePath("/candidate/assessments");
  revalidatePath(`/candidate/assessments/${assignment.id}`);
  if (syncError) {
    return {
      ok: true,
      warning: `AI grades accepted, but the pipeline Test score could not be updated: ${syncError}`,
    };
  }
  return { ok: true };
}

/**
 * Recruiter completes free-response review: records human scores, clears the
 * human-review hold, and sets pass/fail from the pass threshold.
 */
export async function completeAssessmentReviewAction(formData: FormData): Promise<ActionResult> {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const reviewNotes = String(formData.get("review_notes") ?? "").trim();
  if (!assignmentId) return { ok: false, error: "Assignment id is required." };

  const supabase = createClient();
  const { data: assignmentData } = await supabase
    .from("assessment_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  const assignment = assignmentData as AssessmentAssignmentRow | null;
  if (!assignment)
    return { ok: false, error: "Assessment assignment not found or not authorized." };
  if (!["submitted", "graded"].includes(assignment.status) && !assignment.human_review_required) {
    return { ok: false, error: "Only submitted assessments awaiting review can be graded." };
  }

  const seniority = assignment.assessment_seniority as AssessmentSeniority;
  const bank = getQuestionBank(seniority);
  const frQuestions = bank.questions.filter(
    (question): question is BankFreeResponseQuestion => question.kind === "free_response",
  );

  const humanScores: Array<{ questionId: string; score: number; maxScore: number }> = [];
  for (const question of frQuestions) {
    const raw = String(formData.get(`fr_score_${question.id}`) ?? "").trim();
    if (!raw) {
      return { ok: false, error: `Enter a score for free-response question ${question.id}.` };
    }
    const score = Number(raw);
    if (!Number.isFinite(score) || score < 0 || score > question.points) {
      return {
        ok: false,
        error: `Score for ${question.id} must be between 0 and ${question.points}.`,
      };
    }
    humanScores.push({ questionId: question.id, score, maxScore: question.points });
  }

  const payload =
    assignment.grading_payload &&
    typeof assignment.grading_payload === "object" &&
    !Array.isArray(assignment.grading_payload)
      ? ({ ...(assignment.grading_payload as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const mcq =
    payload.mcq && typeof payload.mcq === "object" && !Array.isArray(payload.mcq)
      ? (payload.mcq as { pointsAwarded?: number; pointsPossible?: number })
      : {};
  const mcqAwarded = typeof mcq.pointsAwarded === "number" ? mcq.pointsAwarded : 0;
  const mcqPossible = typeof mcq.pointsPossible === "number" ? mcq.pointsPossible : 0;
  const frAwarded = humanScores.reduce((sum, item) => sum + item.score, 0);
  const frPossible = humanScores.reduce((sum, item) => sum + item.maxScore, 0);
  const pointsPossible = mcqPossible + frPossible;
  const pointsAwarded = mcqAwarded + frAwarded;
  const scorePercent =
    pointsPossible === 0 ? 0 : Math.round((pointsAwarded / pointsPossible) * 10000) / 100;
  const freeResponseScorePercent =
    frPossible === 0 ? null : Math.round((frAwarded / frPossible) * 10000) / 100;
  const passThreshold = Number(assignment.pass_threshold ?? bank.passThresholdPercent);
  const resultBand: "pass" | "fail" = scorePercent >= passThreshold ? "pass" : "fail";
  const actorId = await actor();
  if (!actorId) return { ok: false, error: "Not signed in." };

  const previousFr =
    payload.freeResponse &&
    typeof payload.freeResponse === "object" &&
    !Array.isArray(payload.freeResponse)
      ? (payload.freeResponse as Record<string, unknown>)
      : {};
  const previousResults = Array.isArray(previousFr.results) ? previousFr.results : [];
  const updatedResults = frQuestions.map((question) => {
    const human = humanScores.find((item) => item.questionId === question.id)!;
    const prior = previousResults.find((item) => {
      return (
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as { questionId?: string }).questionId === question.id
      );
    }) as Record<string, unknown> | undefined;
    return {
      ...(prior ?? {}),
      questionId: question.id,
      rubricId: question.rubric.id,
      score: human.score,
      maxScore: human.maxScore,
      percent: human.maxScore === 0 ? 0 : (human.score / human.maxScore) * 100,
      explanation:
        typeof prior?.explanation === "string"
          ? prior.explanation
          : "Scored by recruiter during human review.",
      confidence: 1,
      humanReviewRequired: false,
      model: "recruiter",
      recruiterScore: human.score,
      reviewedBy: actorId,
      reviewedAt: new Date().toISOString(),
    };
  });

  const nextPayload = {
    ...payload,
    version: 1,
    bankId: bank.id,
    freeResponse: {
      version: 1,
      kind: "free_response",
      gradedAt: new Date().toISOString(),
      humanReviewRequired: false,
      results: updatedResults,
      recruiterReview: {
        reviewedBy: actorId,
        reviewedAt: new Date().toISOString(),
        notes: reviewNotes || null,
      },
    },
    scorePercent,
    passThresholdPercent: passThreshold,
    humanReviewCompleted: true,
  } as Json;

  const { error } = await supabase
    .from("assessment_assignments")
    .update({
      status: "graded",
      score: scorePercent,
      free_response_score: freeResponseScorePercent,
      result_band: resultBand,
      human_review_required: false,
      ai_confidence: 1,
      grading_payload: nextPayload,
      grading_notes:
        reviewNotes ||
        `Recruiter free-response review completed. Overall ${scorePercent}% (${resultBand}).`,
      grader_id: actorId,
      graded_at: new Date().toISOString(),
    })
    .eq("id", assignment.id);
  if (error) return { ok: false, error: error.message };

  const app = await loadApplication(assignment.application_id);
  const scoreLabel = String(scorePercent);
  if (app) {
    const { error: appError } = await supabase
      .from("applications")
      .update({
        test_name: app.test_name?.trim() || "Skills assessment",
        test_score: scoreLabel,
      })
      .eq("id", app.id);
    if (appError) {
      return {
        ok: true,
        warning: `Grades saved, but the pipeline Test score could not be updated: ${appError.message}`,
      };
    }
  }

  await writeAudit(
    "assessment.human_reviewed",
    assignment.application_id,
    app?.owning_org_id ?? null,
    {
      score: assignment.score,
      result_band: assignment.result_band,
      human_review_required: assignment.human_review_required,
    },
    {
      score: scorePercent,
      result_band: resultBand,
      human_review_required: false,
      free_response_score: freeResponseScorePercent,
    },
  );

  revalidatePath(`/recruiter/applications/${assignment.application_id}`);
  revalidatePath("/candidate/assessments");
  revalidatePath(`/candidate/assessments/${assignment.id}`);
  return { ok: true };
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
        : toStage === "testing"
          ? `Your application for ${roleLabel} moved to: ${statusLabel}. Open Assessments to take your test.`
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
