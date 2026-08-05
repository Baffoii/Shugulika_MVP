"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isOpenAiConfigured, env } from "@/lib/env";
import {
  AI_INTERVIEW_INSTRUCTIONS_VERSION,
  AI_INTERVIEW_PRIVACY_NOTICE_VERSION,
  AI_INTERVIEW_PROMPT_VERSION,
  AI_INTERVIEW_RESERVE_USD,
  AI_INTERVIEW_RUBRIC_VERSION,
  isAiInterviewEnabled,
} from "@/lib/interviews/ai-interview-flags";
import {
  detectBriefPolicyWarnings,
  generateInterviewPlan,
  InterviewPlanError,
} from "@/lib/interviews/generate-interview-plan";
import {
  createRealtimeClientSecret,
  RealtimeSessionError,
} from "@/lib/interviews/realtime-session";
import {
  transcribeLiveSessionAudio,
  InterviewTranscribeError,
} from "@/lib/interviews/transcribe-session";
import {
  evaluateInterviewEvidence,
  InterviewEvidenceError,
} from "@/lib/interviews/evaluate-evidence";
import type {
  InterviewAssignmentQuestionRow,
  InterviewAssignmentRow,
  InterviewLiveSessionRow,
  InterviewTemplateRow,
  JobInterviewBriefRow,
  JobOrderRow,
  Json,
  OrganizationRow,
} from "@/lib/database.types";

export type AiInterviewActionResult = {
  ok: boolean;
  error?: string;
  id?: string;
  warnings?: string[];
  clientSecret?: string;
  model?: string;
  sessionId?: string;
  expiresAt?: string | null;
};

const STAFF_ROLES = new Set(["recruiter", "franchise_admin", "operations", "hq_admin"]);

async function staffContext(preferredOrgId?: string | null) {
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id,role,status")
    .eq("user_id", user.id)
    .eq("status", "active");
  const staffMemberships = (
    (memberships as { organization_id: string | null; role: string; status: string }[] | null) ?? []
  ).filter((item) => item.organization_id && STAFF_ROLES.has(item.role));
  if (!staffMemberships.length) return null;
  const preferred = preferredOrgId
    ? staffMemberships.find((item) => item.organization_id === preferredOrgId)
    : null;
  const membership =
    preferred ?? staffMemberships.find((item) => item.role !== "hq_admin") ?? staffMemberships[0];
  return membership?.organization_id
    ? { supabase, userId: user.id, orgId: membership.organization_id }
    : null;
}

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

/** Employer or staff: save / submit an interview brief on a job order. */
export async function upsertJobInterviewBriefAction(
  formData: FormData,
): Promise<AiInterviewActionResult> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };

  const jobOrderId = text(formData.get("job_order_id"));
  if (!jobOrderId) return { ok: false, error: "Missing job order." };

  const useAiVoice =
    formData.get("use_ai_voice") === "on" || formData.get("use_ai_voice") === "true";
  const employerNotes = text(formData.get("employer_notes")) || null;
  const warnings = detectBriefPolicyWarnings(employerNotes);

  const payload = {
    job_order_id: jobOrderId,
    use_ai_voice: useAiVoice,
    language: text(formData.get("language")) || "en",
    duration_seconds: Number(text(formData.get("duration_seconds")) || "600"),
    role_priorities: text(formData.get("role_priorities")) || null,
    must_have_competencies: text(formData.get("must_have_competencies")) || null,
    required_topics: text(formData.get("required_topics")) || null,
    situational_scenario: text(formData.get("situational_scenario")) || null,
    company_values: text(formData.get("company_values")) || null,
    objective_requirements: text(formData.get("objective_requirements")) || null,
    employer_notes: employerNotes,
    original_notes: employerNotes,
    policy_warnings: warnings,
    status: "submitted" as const,
    submitted_by: auth.user.id,
    submitted_at: new Date().toISOString(),
    version: 1,
  };

  const { data: existing } = await supabase
    .from("job_interview_briefs")
    .select("id,version")
    .eq("job_order_id", jobOrderId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  let briefId: string;
  if (existing) {
    const row = existing as { id: string; version: number };
    const { error } = await supabase
      .from("job_interview_briefs")
      .update({
        ...payload,
        version: row.version,
      })
      .eq("id", row.id);
    if (error) return { ok: false, error: error.message };
    briefId = row.id;
  } else {
    const { data, error } = await supabase
      .from("job_interview_briefs")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    briefId = (data as { id: string }).id;
  }

  revalidatePath(`/employer/job-orders`);
  revalidatePath(`/recruiter/jobs`);
  return { ok: true, id: briefId, warnings };
}

/** Staff: approve brief, generate AI plan, create/freeze live_ai_voice template. */
export async function generateAndFreezeAiInterviewPlanAction(
  formData: FormData,
): Promise<AiInterviewActionResult> {
  if (!(await isAiInterviewEnabled())) {
    return { ok: false, error: "AI voice interviews are disabled." };
  }
  if (!isOpenAiConfigured()) {
    return { ok: false, error: "OPENAI_API_KEY is not configured on the server." };
  }

  const jobOrderId = text(formData.get("job_order_id"));
  const briefId = text(formData.get("brief_id"));
  const context = await staffContext();
  if (!context) return { ok: false, error: "Not authorized." };
  if (!jobOrderId) return { ok: false, error: "Missing job order." };

  const { data: jobData } = await context.supabase
    .from("job_orders")
    .select("*")
    .eq("id", jobOrderId)
    .maybeSingle();
  const job = jobData as JobOrderRow | null;
  if (!job) return { ok: false, error: "Job order not found." };

  const orgContext = await staffContext(job.responsible_org_id);
  if (!orgContext || orgContext.orgId !== job.responsible_org_id) {
    return { ok: false, error: "Job order not in your organization scope." };
  }

  let brief: JobInterviewBriefRow | null = null;
  if (briefId) {
    const { data } = await orgContext.supabase
      .from("job_interview_briefs")
      .select("*")
      .eq("id", briefId)
      .maybeSingle();
    brief = data as JobInterviewBriefRow | null;
  } else {
    const { data } = await orgContext.supabase
      .from("job_interview_briefs")
      .select("*")
      .eq("job_order_id", jobOrderId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    brief = data as JobInterviewBriefRow | null;
  }

  if (!brief) {
    const { data: created, error: createErr } = await orgContext.supabase
      .from("job_interview_briefs")
      .insert({
        job_order_id: jobOrderId,
        use_ai_voice: true,
        language: "en",
        duration_seconds: 600,
        status: "submitted",
        submitted_by: orgContext.userId,
        submitted_at: new Date().toISOString(),
        version: 1,
        policy_warnings: [],
        sanitised_brief: {},
      })
      .select("*")
      .single();
    if (createErr) return { ok: false, error: createErr.message };
    brief = created as JobInterviewBriefRow;
  } else if (!brief.use_ai_voice) {
    const { data: updated, error: updateErr } = await orgContext.supabase
      .from("job_interview_briefs")
      .update({ use_ai_voice: true })
      .eq("id", brief.id)
      .select("*")
      .single();
    if (updateErr) return { ok: false, error: updateErr.message };
    brief = updated as JobInterviewBriefRow;
  }

  const { data: employerOrg } = await orgContext.supabase
    .from("organizations")
    .select("*")
    .eq("id", job.employer_org_id)
    .maybeSingle();
  const employer = employerOrg as OrganizationRow | null;

  try {
    const plan = await generateInterviewPlan({
      jobTitle: job.title,
      department: job.department,
      description: job.description,
      responsibilities: job.responsibilities,
      requirements: job.requirements,
      experienceLevel: job.experience_level,
      companyName: employer?.name ?? "Employer",
      industry: (employer as { industry?: string | null } | null)?.industry ?? null,
      rolePriorities: brief.role_priorities,
      mustHaveCompetencies: brief.must_have_competencies,
      requiredTopics: brief.required_topics,
      situationalScenario: brief.situational_scenario,
      companyValues: brief.company_values,
      objectiveRequirements: brief.objective_requirements,
      employerNotes: brief.employer_notes,
      language: brief.language,
      durationSeconds: brief.duration_seconds,
    });

    await orgContext.supabase
      .from("job_interview_briefs")
      .update({
        status: "approved",
        approved_by: orgContext.userId,
        approved_at: new Date().toISOString(),
        sanitised_brief: {
          role_priorities: brief.role_priorities,
          must_have_competencies: brief.must_have_competencies,
          required_topics: brief.required_topics,
          situational_scenario: brief.situational_scenario,
          company_values: brief.company_values,
          objective_requirements: brief.objective_requirements,
        },
        policy_warnings: [...(brief.policy_warnings ?? []), ...plan.policy_warnings],
      })
      .eq("id", brief.id);

    const templateName = `AI voice — ${job.title}`.slice(0, 160);
    const templatePayload = {
      name: templateName,
      description: `Standardized live AI voice interview for ${job.title}`,
      instructions: plan.interviewer_instructions,
      default_preparation_seconds: 0,
      default_response_seconds: Math.min(180, Math.floor(brief.duration_seconds / 4)),
      default_max_attempts: 1,
      retention_days: 180,
      allow_pause_between_questions: false,
      allow_response_review: false,
      default_deadline_days: 7,
      expiration_grace_hours: 1,
      interview_mode: "live_ai_voice" as const,
      duration_seconds: brief.duration_seconds,
      language: brief.language,
      model: env.openaiRealtimeModel(),
      prompt_version: AI_INTERVIEW_PROMPT_VERSION,
      rubric_version: AI_INTERVIEW_RUBRIC_VERSION,
      plan_status: "frozen" as const,
      approved_by: orgContext.userId,
      approved_at: new Date().toISOString(),
      job_interview_brief_id: brief.id,
      frozen_context: {
        welcome_script: plan.welcome_script,
        close_script: plan.close_script,
        interviewer_instructions: plan.interviewer_instructions,
        job_title: job.title,
        company_name: employer?.name ?? null,
      },
      is_active: true,
    };

    // One standardized AI template per brief — regenerate updates in place.
    const { data: existingRows } = await orgContext.supabase
      .from("interview_templates")
      .select("id")
      .eq("job_interview_brief_id", brief.id)
      .eq("interview_mode", "live_ai_voice")
      .eq("is_active", true)
      .order("updated_at", { ascending: false });
    const existingIds = ((existingRows as { id: string }[] | null) ?? []).map((row) => row.id);
    const keepId = existingIds[0] ?? null;
    const duplicateIds = existingIds.slice(1);
    if (duplicateIds.length) {
      await orgContext.supabase
        .from("interview_templates")
        .update({ is_active: false })
        .in("id", duplicateIds);
    }

    let template: InterviewTemplateRow;
    if (keepId) {
      const { data: templateData, error: templateError } = await orgContext.supabase
        .from("interview_templates")
        .update(templatePayload)
        .eq("id", keepId)
        .select("*")
        .single();
      if (templateError) return { ok: false, error: templateError.message };
      template = templateData as InterviewTemplateRow;
      await orgContext.supabase
        .from("interview_template_questions")
        .delete()
        .eq("template_id", template.id);
    } else {
      const { data: templateData, error: templateError } = await orgContext.supabase
        .from("interview_templates")
        .insert({
          ...templatePayload,
          organization_id: job.responsible_org_id,
          created_by: orgContext.userId,
        })
        .select("*")
        .single();
      if (templateError) return { ok: false, error: templateError.message };
      template = templateData as InterviewTemplateRow;
    }

    const questionRows = plan.questions.map((q) => ({
      template_id: template.id,
      question_text: q.question_text,
      guidance: q.expected_evidence,
      display_order: q.ordinal,
      preparation_seconds: 0,
      response_seconds: q.timing_seconds,
      max_attempts: 1,
      is_required: true,
      competency: q.competency,
      expected_evidence: q.expected_evidence,
      rubric_anchors: q.rubric_anchors,
      source_context: q.source_context,
      follow_up_policy: q.follow_up_policy,
    }));
    const { error: qErr } = await orgContext.supabase
      .from("interview_template_questions")
      .insert(questionRows);
    if (qErr) {
      if (!keepId) {
        await orgContext.supabase.from("interview_templates").delete().eq("id", template.id);
      }
      return { ok: false, error: qErr.message };
    }

    revalidatePath("/recruiter/interview-templates");
    revalidatePath(`/recruiter/interview-templates/${template.id}`);
    revalidatePath("/recruiter/jobs");
    return {
      ok: true,
      id: template.id,
      warnings: [...(brief.policy_warnings ?? []), ...plan.policy_warnings],
    };
  } catch (error) {
    const message =
      error instanceof InterviewPlanError
        ? error.message
        : "Could not generate and standardize the interview plan.";
    return { ok: false, error: message };
  }
}

/** Freeze an existing draft live_ai_voice template after staff edits. */
export async function freezeAiInterviewTemplateAction(
  formData: FormData,
): Promise<AiInterviewActionResult> {
  const templateId = text(formData.get("template_id"));
  const context = await staffContext();
  if (!context) return { ok: false, error: "Not authorized." };
  const { data } = await context.supabase
    .from("interview_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  const template = data as InterviewTemplateRow | null;
  if (!template || template.interview_mode !== "live_ai_voice") {
    return { ok: false, error: "Live AI template not found." };
  }
  if (template.organization_id !== context.orgId && !(await isHq(context.userId))) {
    return { ok: false, error: "Not authorized for this template." };
  }
  const { data: questions } = await context.supabase
    .from("interview_template_questions")
    .select("id")
    .eq("template_id", templateId);
  if (!questions?.length) return { ok: false, error: "Add at least 4 questions before freezing." };

  const { error } = await context.supabase
    .from("interview_templates")
    .update({
      plan_status: "frozen",
      approved_by: context.userId,
      approved_at: new Date().toISOString(),
      prompt_version: template.prompt_version ?? AI_INTERVIEW_PROMPT_VERSION,
      rubric_version: template.rubric_version ?? AI_INTERVIEW_RUBRIC_VERSION,
      model: template.model ?? env.openaiRealtimeModel(),
    })
    .eq("id", templateId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/recruiter/interview-templates/${templateId}`);
  return { ok: true, id: templateId };
}

async function isHq(userId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("role", "hq_admin")
    .limit(1);
  return Boolean(data?.length);
}

/** Candidate: mint ephemeral Realtime credential + create live session row. */
export async function startLiveAiSessionAction(
  assignmentId: string,
): Promise<AiInterviewActionResult> {
  if (!(await isAiInterviewEnabled())) {
    return { ok: false, error: "AI voice interviews are disabled." };
  }
  if (!isOpenAiConfigured()) {
    return { ok: false, error: "OpenAI is not configured." };
  }

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };

  const { data: assignmentData } = await supabase
    .from("interview_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  const assignment = assignmentData as InterviewAssignmentRow | null;
  if (!assignment || assignment.interview_mode !== "live_ai_voice") {
    return { ok: false, error: "Live AI interview not found." };
  }
  if (!assignment.consented_at) {
    return { ok: false, error: "Consent is required before starting." };
  }
  if (!["invited", "in_progress"].includes(assignment.status)) {
    return { ok: false, error: "This interview is not active." };
  }

  const { data: questionsData } = await supabase
    .from("interview_assignment_questions")
    .select("*")
    .eq("assignment_id", assignmentId)
    .order("display_order");
  const questions = (questionsData as InterviewAssignmentQuestionRow[] | null) ?? [];
  if (questions.length < 4) {
    return { ok: false, error: "Interview plan is incomplete." };
  }

  const { data: job } = await supabase
    .from("job_orders")
    .select("title")
    .eq("id", assignment.job_order_id)
    .maybeSingle();
  const jobTitle = (job as { title: string } | null)?.title ?? assignment.template_name_snapshot;

  // Ensure assignment is in_progress
  if (assignment.status === "invited") {
    const { error: startErr } = await supabase
      .from("interview_assignments")
      .update({
        status: "in_progress",
        started_at: new Date().toISOString(),
        consented_at: assignment.consented_at,
        privacy_notice_version:
          assignment.privacy_notice_version ?? AI_INTERVIEW_PRIVACY_NOTICE_VERSION,
        instructions_version: assignment.instructions_version ?? AI_INTERVIEW_INSTRUCTIONS_VERSION,
      })
      .eq("id", assignmentId);
    if (startErr) return { ok: false, error: startErr.message };
  }

  try {
    const secret = await createRealtimeClientSecret({
      userId: auth.user.id,
      assignment,
      questions,
      jobTitle,
    });

    const { data: sessionData, error: sessionError } = await supabase
      .from("interview_live_sessions")
      .insert({
        assignment_id: assignmentId,
        status: "ready",
        model: secret.model,
        prompt_version: assignment.prompt_version ?? AI_INTERVIEW_PROMPT_VERSION,
        rubric_version: assignment.rubric_version ?? AI_INTERVIEW_RUBRIC_VERSION,
        openai_session_ref: secret.sessionIdHint,
        reserved_usd: AI_INTERVIEW_RESERVE_USD,
      })
      .select("*")
      .single();
    if (sessionError) return { ok: false, error: sessionError.message };
    const session = sessionData as InterviewLiveSessionRow;

    await supabase.from("interview_events").insert({
      assignment_id: assignmentId,
      actor_user_id: auth.user.id,
      event_type: "live_session_ready",
      metadata: { session_id: session.id, model: secret.model },
    });

    return {
      ok: true,
      sessionId: session.id,
      clientSecret: secret.clientSecret,
      model: secret.model,
      expiresAt: secret.expiresAt,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof RealtimeSessionError ? error.message : "Could not start session.",
    };
  }
}

export async function markLiveSessionLiveAction(
  sessionId: string,
): Promise<AiInterviewActionResult> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };
  const { data, error } = await supabase
    .from("interview_live_sessions")
    .update({ status: "live", started_at: new Date().toISOString() })
    .eq("id", sessionId)
    .select("assignment_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const assignmentId = (data as { assignment_id: string } | null)?.assignment_id;
  if (assignmentId) {
    await supabase.from("interview_events").insert({
      assignment_id: assignmentId,
      actor_user_id: auth.user.id,
      event_type: "live_session_started",
      metadata: { session_id: sessionId },
    });
  }
  return { ok: true, sessionId };
}

export async function liveInterviewToolAction(input: {
  sessionId: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<AiInterviewActionResult> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };

  const { data: sessionData } = await supabase
    .from("interview_live_sessions")
    .select("*")
    .eq("id", input.sessionId)
    .maybeSingle();
  const session = sessionData as InterviewLiveSessionRow | null;
  if (!session) return { ok: false, error: "Session not found." };

  const { data: assignmentData } = await supabase
    .from("interview_assignments")
    .select("*")
    .eq("id", session.assignment_id)
    .maybeSingle();
  const assignment = assignmentData as InterviewAssignmentRow | null;
  if (!assignment) return { ok: false, error: "Assignment not found." };

  const { data: questionsData } = await supabase
    .from("interview_assignment_questions")
    .select("*")
    .eq("assignment_id", assignment.id)
    .order("display_order", { ascending: true });
  const questions = (questionsData as InterviewAssignmentQuestionRow[] | null) ?? [];

  function resolveQuestionId(args: Record<string, unknown>): string | null {
    const ordered = [...questions].sort((a, b) => a.display_order - b.display_order);
    const orderRaw = args.question_order ?? args.order ?? args.question_number;
    if (typeof orderRaw === "number" && Number.isFinite(orderRaw)) {
      const byOrder = ordered[Math.trunc(orderRaw) - 1];
      if (byOrder) return byOrder.id;
    }
    if (typeof orderRaw === "string" && /^\d+$/.test(orderRaw.trim())) {
      const byOrder = ordered[Number(orderRaw.trim()) - 1];
      if (byOrder) return byOrder.id;
    }

    const rawId = String(
      args.question_snapshot_id ?? args.question_id ?? args.assignment_question_id ?? "",
    ).trim();
    if (!rawId) return null;
    if (questions.some((q) => q.id === rawId)) return rawId;
    if (/^\d+$/.test(rawId)) {
      const byOrder = ordered[Number(rawId) - 1];
      if (byOrder) return byOrder.id;
    }
    const match = rawId.match(/(?:^|[^0-9])([1-9]\d*)(?:[^0-9]|$)/);
    if (match) {
      const byOrder = ordered[Number(match[1]) - 1];
      if (byOrder) return byOrder.id;
    }
    return null;
  }

  const needsQuestion = ["start_question", "complete_question", "record_clarification"].includes(
    input.tool,
  );
  const qid = needsQuestion ? resolveQuestionId(input.args) : null;
  if (needsQuestion && !qid) {
    return {
      ok: false,
      error: "Unknown question. Use question_order as 1, 2, 3… from the interview list.",
    };
  }

  if (input.tool === "start_question") {
    await supabase
      .from("interview_assignment_questions")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", qid!)
      .eq("status", "pending");
    await supabase.from("interview_turns").insert({
      session_id: session.id,
      assignment_question_id: qid!,
      speaker: "ai",
      turn_type: "question",
      started_at: new Date().toISOString(),
    });
    await supabase.from("interview_events").insert({
      assignment_id: assignment.id,
      assignment_question_id: qid!,
      actor_user_id: auth.user.id,
      event_type: "live_question_started",
      metadata: { session_id: session.id },
    });
    return { ok: true, id: qid! };
  }

  if (input.tool === "complete_question") {
    await supabase
      .from("interview_assignment_questions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", qid!);
    await supabase.from("interview_events").insert({
      assignment_id: assignment.id,
      assignment_question_id: qid!,
      actor_user_id: auth.user.id,
      event_type: "live_question_completed",
      metadata: {
        session_id: session.id,
        evidence_status: String(input.args.evidence_status ?? ""),
      },
    });
    const remaining = questions.filter((q) => q.id !== qid && q.status !== "completed");
    return {
      ok: true,
      id: qid!,
      warnings: remaining.length === 0 ? ["all_questions_complete"] : undefined,
    };
  }

  if (input.tool === "record_clarification") {
    const followUpIndex =
      typeof input.args.follow_up_index === "number"
        ? Math.trunc(input.args.follow_up_index)
        : typeof input.args.follow_up_index === "string" &&
            /^\d+$/.test(input.args.follow_up_index.trim())
          ? Number(input.args.follow_up_index.trim())
          : null;
    await supabase.from("interview_turns").insert({
      session_id: session.id,
      assignment_question_id: qid!,
      speaker: "ai",
      turn_type: "clarification",
      transcript: String(input.args.reason ?? ""),
      started_at: new Date().toISOString(),
    });
    await supabase.from("interview_events").insert({
      assignment_id: assignment.id,
      assignment_question_id: qid!,
      actor_user_id: auth.user.id,
      event_type: "live_clarification",
      metadata: {
        session_id: session.id,
        reason: String(input.args.reason ?? ""),
        ...(followUpIndex != null ? { follow_up_index: followUpIndex } : {}),
      },
    });
    return { ok: true, id: qid! };
  }

  if (input.tool === "report_technical_issue") {
    await supabase.from("interview_events").insert({
      assignment_id: assignment.id,
      actor_user_id: auth.user.id,
      event_type: "live_technical_issue",
      metadata: { session_id: session.id, issue_type: String(input.args.issue_type ?? "") },
    });
    return { ok: true };
  }

  if (input.tool === "finish_interview") {
    const reason = String(input.args.completion_reason ?? "completed");
    const status =
      reason === "technical"
        ? "incomplete_technical"
        : reason === "candidate_left"
          ? "abandoned"
          : "completed";
    const startedAt = session.started_at ? new Date(session.started_at).getTime() : Date.now();
    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    await supabase
      .from("interview_live_sessions")
      .update({
        status,
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
      })
      .eq("id", session.id);
    await supabase.from("interview_events").insert({
      assignment_id: assignment.id,
      actor_user_id: auth.user.id,
      event_type: "live_session_ended",
      metadata: { session_id: session.id, completion_reason: reason },
    });
    return { ok: true, sessionId: session.id };
  }

  return { ok: false, error: `Unsupported tool: ${input.tool}` };
}

export async function attachLiveSessionAudioAction(input: {
  sessionId: string;
  storagePath: string;
  mimeType: string;
  bucket?: string;
}): Promise<AiInterviewActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("interview_live_sessions")
    .update({
      candidate_audio_bucket: input.bucket ?? "interview-recordings",
      candidate_audio_path: input.storagePath,
      candidate_audio_mime: input.mimeType,
    })
    .eq("id", input.sessionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, sessionId: input.sessionId };
}

export async function completeLiveAiInterviewAction(
  sessionId: string,
): Promise<AiInterviewActionResult> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "Not signed in." };

  const { data: sessionData } = await supabase
    .from("interview_live_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  const session = sessionData as InterviewLiveSessionRow | null;
  if (!session) return { ok: false, error: "Session not found." };

  // Ensure terminal status before submit_interview gate
  if (!["completed", "incomplete_technical", "abandoned"].includes(session.status)) {
    await supabase
      .from("interview_live_sessions")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  // Mark remaining questions complete for live mode
  await supabase
    .from("interview_assignment_questions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("assignment_id", session.assignment_id)
    .neq("status", "completed");

  const { error: submitError } = await supabase.rpc("submit_interview", {
    p_assignment_id: session.assignment_id,
  });
  if (submitError) {
    // Last-resort finalize if the RPC rejects a already-ended live session.
    const { data: assignmentRow } = await supabase
      .from("interview_assignments")
      .select("status")
      .eq("id", session.assignment_id)
      .maybeSingle();
    const status = (assignmentRow as { status: string } | null)?.status;
    if (status === "submitted" || status === "reviewed") {
      // Already finalized.
    } else {
      return { ok: false, error: submitError.message };
    }
  }

  // Post-process (transcribe/evaluate) in the background so the candidate UI can close promptly.
  void runPostInterviewProcessing(sessionId).catch(() => {
    /* staff can retry from recruiter results */
  });

  revalidatePath(`/candidate/interviews/${session.assignment_id}`);
  revalidatePath(`/candidate/interviews/${session.assignment_id}/session`);
  revalidatePath(`/recruiter/interviews/${session.assignment_id}`);
  return { ok: true, sessionId };
}

export async function runPostInterviewProcessingAction(
  sessionId: string,
): Promise<AiInterviewActionResult> {
  const context = await staffContext();
  if (!context) return { ok: false, error: "Not authorized." };
  try {
    await runPostInterviewProcessing(sessionId);
    return { ok: true, sessionId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Post-processing failed.",
    };
  }
}

async function runPostInterviewProcessing(sessionId: string): Promise<void> {
  if (!isOpenAiConfigured()) return;
  const supabase = createClient();
  const { data: sessionData } = await supabase
    .from("interview_live_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  const session = sessionData as InterviewLiveSessionRow | null;
  if (!session) throw new Error("Session not found");

  await supabase.from("interview_events").insert({
    assignment_id: session.assignment_id,
    event_type: "transcription_started",
    metadata: { session_id: sessionId },
  });

  let transcript = "";
  try {
    if (session.candidate_audio_path) {
      const result = await transcribeLiveSessionAudio(session);
      transcript = result.text;
      await supabase
        .from("interview_live_sessions")
        .update({
          transcription_usage: { duration_ms: result.durationMs, chars: transcript.length },
        })
        .eq("id", sessionId);
    }
    await supabase.from("interview_events").insert({
      assignment_id: session.assignment_id,
      event_type: "transcription_completed",
      metadata: { session_id: sessionId, chars: transcript.length },
    });
  } catch (error) {
    await supabase.from("interview_events").insert({
      assignment_id: session.assignment_id,
      event_type: "transcription_failed",
      metadata: {
        session_id: sessionId,
        message: error instanceof InterviewTranscribeError ? error.message : "failed",
      },
    });
  }

  const { data: questionsData } = await supabase
    .from("interview_assignment_questions")
    .select("*")
    .eq("assignment_id", session.assignment_id)
    .order("display_order");
  const questions = (questionsData as InterviewAssignmentQuestionRow[] | null) ?? [];

  // Store full transcript as a candidate system turn; split roughly by question count.
  if (transcript) {
    const chunks = splitTranscript(transcript, questions.length || 1);
    for (let i = 0; i < questions.length; i++) {
      await supabase.from("interview_turns").insert({
        session_id: sessionId,
        assignment_question_id: questions[i]?.id ?? null,
        speaker: "candidate",
        turn_type: "utterance",
        transcript: chunks[i] ?? "",
        completion_state: chunks[i]?.trim() ? "complete" : "missing",
      });
    }
  }

  const { data: assignmentData } = await supabase
    .from("interview_assignments")
    .select("*")
    .eq("id", session.assignment_id)
    .maybeSingle();
  const assignment = assignmentData as InterviewAssignmentRow | null;
  const { data: job } = await supabase
    .from("job_orders")
    .select("title")
    .eq("id", assignment?.job_order_id ?? "")
    .maybeSingle();

  await supabase.from("interview_events").insert({
    assignment_id: session.assignment_id,
    event_type: "ai_evaluation_started",
    metadata: { session_id: sessionId },
  });

  try {
    const evidence = await evaluateInterviewEvidence({
      jobTitle: (job as { title: string } | null)?.title ?? "Role",
      questions: questions.map((q, i) => ({
        assignmentQuestionId: q.id,
        questionText: q.question_text_snapshot,
        competency: q.competency,
        expectedEvidence: q.expected_evidence,
        rubricAnchors: q.rubric_anchors,
        candidateTranscript: splitTranscript(transcript, questions.length)[i] ?? transcript,
      })),
    });

    await supabase.from("interview_ai_evaluations").upsert(
      {
        session_id: sessionId,
        assignment_id: session.assignment_id,
        model: env.openaiScreeningModel(),
        prompt_version: session.prompt_version,
        rubric_version: session.rubric_version,
        structured_evidence: {
          summary_for_recruiter: evidence.summary_for_recruiter,
        },
        question_results: evidence.question_results,
        overall_confidence: evidence.overall_confidence,
        review_flags: evidence.review_flags,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "session_id" },
    );

    await supabase.from("interview_events").insert({
      assignment_id: session.assignment_id,
      event_type: "ai_evaluation_completed",
      metadata: { session_id: sessionId },
    });
  } catch (error) {
    await supabase.from("interview_events").insert({
      assignment_id: session.assignment_id,
      event_type: "ai_evaluation_failed",
      metadata: {
        session_id: sessionId,
        message: error instanceof InterviewEvidenceError ? error.message : "failed",
      },
    });
  }
}

function splitTranscript(text: string, parts: number): string[] {
  if (parts <= 1) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return Array.from({ length: parts }, () => "");
  const size = Math.ceil(words.length / parts);
  const out: string[] = [];
  for (let i = 0; i < parts; i++) {
    out.push(words.slice(i * size, (i + 1) * size).join(" "));
  }
  return out;
}

export async function saveEvidenceOverridesAction(
  formData: FormData,
): Promise<AiInterviewActionResult> {
  const context = await staffContext();
  if (!context) return { ok: false, error: "Not authorized." };
  const assignmentId = text(formData.get("assignment_id"));
  const overridesRaw = text(formData.get("evidence_overrides"));
  let overrides: Json = [];
  try {
    overrides = overridesRaw ? (JSON.parse(overridesRaw) as Json) : [];
  } catch {
    return { ok: false, error: "Invalid overrides JSON." };
  }
  const evaluationId = text(formData.get("ai_evaluation_id")) || null;
  const { data: existing } = await context.supabase
    .from("interview_reviews")
    .select("id")
    .eq("assignment_id", assignmentId)
    .maybeSingle();
  if (existing) {
    const { error } = await context.supabase
      .from("interview_reviews")
      .update({
        evidence_overrides: overrides,
        ai_evaluation_id: evaluationId,
      })
      .eq("assignment_id", assignmentId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await context.supabase.from("interview_reviews").insert({
      assignment_id: assignmentId,
      recruiter_id: context.userId,
      evidence_overrides: overrides,
      ai_evaluation_id: evaluationId,
      review_status: "pending",
    });
    if (error) return { ok: false, error: error.message };
  }
  await context.supabase.from("interview_events").insert({
    assignment_id: assignmentId,
    actor_user_id: context.userId,
    event_type: "evidence_overridden",
    metadata: {},
  });
  revalidatePath(`/recruiter/interviews/${assignmentId}`);
  return { ok: true, id: assignmentId };
}

/** Used by assignment creation to copy live AI snapshot fields. */
export async function getLiveTemplateExtras(template: InterviewTemplateRow) {
  return {
    interview_mode: template.interview_mode,
    duration_seconds: template.duration_seconds,
    language: template.language,
    model: template.model,
    prompt_version: template.prompt_version,
    rubric_version: template.rubric_version,
    frozen_context: template.frozen_context,
  };
}
