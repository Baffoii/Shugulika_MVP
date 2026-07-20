"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  interviewAssignmentSchema,
  interviewQuestionSchema,
  interviewReviewSchema,
  interviewTemplateSchema,
} from "@/lib/validation";
import type {
  ApplicationRow,
  InterviewAssignmentRow,
  InterviewResponseAttemptRow,
  InterviewTemplateQuestionRow,
  InterviewTemplateRow,
} from "@/lib/database.types";

export type InterviewActionResult = {
  ok: boolean;
  error?: string;
  id?: string;
  url?: string;
};

const STAFF_ROLES = new Set(["recruiter", "franchise_admin", "operations", "hq_admin"]);

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

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
  // Prefer an explicit org, otherwise the first franchise/employer-scoped staff
  // membership rather than an HQ membership that cannot own templates.
  const membership =
    preferred ?? staffMemberships.find((item) => item.role !== "hq_admin") ?? staffMemberships[0];
  return membership?.organization_id
    ? { supabase, userId: user.id, orgId: membership.organization_id }
    : null;
}

function endOfLocalDayIso(dateInput: string): string | null {
  // HTML date inputs are calendar days. Interpret as local end-of-day so
  // "today" remains valid and recruiter/candidate deadlines match the date UI.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput.trim());
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    return Number.isNaN(end.getTime()) ? null : end.toISOString();
  }
  const parsed = new Date(dateInput);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function scopedTemplate(id: string) {
  const context = await staffContext();
  if (!context) return null;
  const { data } = await context.supabase
    .from("interview_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ? { context, template: data as InterviewTemplateRow } : null;
}

async function scopedAssignment(id: string) {
  const context = await staffContext();
  if (!context) return null;
  const { data } = await context.supabase
    .from("interview_assignments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ? { context, assignment: data as InterviewAssignmentRow } : null;
}

function parseTemplateForm(formData: FormData) {
  return interviewTemplateSchema.safeParse({
    name: text(formData.get("name")),
    description: text(formData.get("description")),
    instructions: text(formData.get("instructions")),
    default_preparation_seconds: text(formData.get("default_preparation_seconds")),
    default_response_seconds: text(formData.get("default_response_seconds")),
    default_max_attempts: text(formData.get("default_max_attempts")),
    retention_days: text(formData.get("retention_days")),
    allow_pause_between_questions: formData.get("allow_pause_between_questions") === "on",
    allow_response_review: formData.get("allow_response_review") === "on",
    default_deadline_days: text(formData.get("default_deadline_days")) || "7",
    expiration_grace_hours: text(formData.get("expiration_grace_hours")) || "0",
  });
}

export async function createTemplateAction(formData: FormData): Promise<InterviewActionResult> {
  const context = await staffContext();
  if (!context) return { ok: false, error: "Not signed in or not authorized." };
  const parsed = parseTemplateForm(formData);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };
  const { data, error } = await context.supabase
    .from("interview_templates")
    .insert({
      ...parsed.data,
      description: parsed.data.description || null,
      instructions: parsed.data.instructions || null,
      organization_id: context.orgId,
      created_by: context.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/recruiter/interview-templates");
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateTemplateAction(formData: FormData): Promise<InterviewActionResult> {
  const templateId = text(formData.get("template_id"));
  const scoped = await scopedTemplate(templateId);
  if (!scoped) return { ok: false, error: "Template not found or not authorized." };
  const parsed = parseTemplateForm(formData);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid template." };
  const { error } = await scoped.context.supabase
    .from("interview_templates")
    .update({
      ...parsed.data,
      description: parsed.data.description || null,
      instructions: parsed.data.instructions || null,
    })
    .eq("id", templateId)
    .eq("organization_id", scoped.template.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/recruiter/interview-templates/${templateId}`);
  revalidatePath("/recruiter/interview-templates");
  return { ok: true };
}

export async function duplicateTemplateAction(formData: FormData): Promise<InterviewActionResult> {
  const templateId = text(formData.get("template_id"));
  const scoped = await scopedTemplate(templateId);
  if (!scoped) return { ok: false, error: "Template not found or not authorized." };
  const { data: questions } = await scoped.context.supabase
    .from("interview_template_questions")
    .select("*")
    .eq("template_id", templateId)
    .order("display_order");
  const { data: copy, error } = await scoped.context.supabase
    .from("interview_templates")
    .insert({
      organization_id: scoped.template.organization_id,
      name: `${scoped.template.name} (copy)`,
      description: scoped.template.description,
      instructions: scoped.template.instructions,
      default_preparation_seconds: scoped.template.default_preparation_seconds,
      default_response_seconds: scoped.template.default_response_seconds,
      default_max_attempts: scoped.template.default_max_attempts,
      retention_days: scoped.template.retention_days,
      allow_pause_between_questions: scoped.template.allow_pause_between_questions,
      allow_response_review: scoped.template.allow_response_review,
      default_deadline_days: scoped.template.default_deadline_days,
      expiration_grace_hours: scoped.template.expiration_grace_hours,
      created_by: scoped.context.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  const copyId = (copy as { id: string }).id;
  const rows = ((questions as InterviewTemplateQuestionRow[] | null) ?? []).map((question) => ({
    template_id: copyId,
    question_text: question.question_text,
    guidance: question.guidance,
    display_order: question.display_order,
    preparation_seconds: question.preparation_seconds,
    response_seconds: question.response_seconds,
    max_attempts: question.max_attempts,
    is_required: question.is_required,
  }));
  if (rows.length) {
    const { error: questionError } = await scoped.context.supabase
      .from("interview_template_questions")
      .insert(rows);
    if (questionError) {
      await scoped.context.supabase.from("interview_templates").delete().eq("id", copyId);
      return { ok: false, error: questionError.message };
    }
  }
  revalidatePath("/recruiter/interview-templates");
  return { ok: true, id: copyId };
}

export async function archiveTemplateAction(formData: FormData): Promise<InterviewActionResult> {
  const templateId = text(formData.get("template_id"));
  const scoped = await scopedTemplate(templateId);
  if (!scoped) return { ok: false, error: "Template not found or not authorized." };
  const { error } = await scoped.context.supabase
    .from("interview_templates")
    .update({ is_active: false })
    .eq("id", templateId)
    .eq("organization_id", scoped.template.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/recruiter/interview-templates");
  revalidatePath(`/recruiter/interview-templates/${templateId}`);
  return { ok: true };
}

export async function addQuestionAction(formData: FormData): Promise<InterviewActionResult> {
  const templateId = text(formData.get("template_id"));
  const scoped = await scopedTemplate(templateId);
  if (!scoped) return { ok: false, error: "Template not found or not authorized." };
  const parsed = interviewQuestionSchema.safeParse({
    question_text: text(formData.get("question_text")),
    guidance: text(formData.get("guidance")),
    preparation_seconds: text(formData.get("preparation_seconds")),
    response_seconds: text(formData.get("response_seconds")),
    max_attempts: text(formData.get("max_attempts")),
    is_required: formData.get("is_required") === "on",
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid question." };
  const { data: last } = await scoped.context.supabase
    .from("interview_template_questions")
    .select("display_order")
    .eq("template_id", templateId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const value = parsed.data;
  const nextOrder = ((last as { display_order: number } | null)?.display_order ?? 0) + 1;
  const { error } = await scoped.context.supabase.from("interview_template_questions").insert({
    template_id: templateId,
    question_text: value.question_text,
    guidance: value.guidance || null,
    display_order: nextOrder,
    preparation_seconds: value.preparation_seconds === "" ? null : value.preparation_seconds,
    response_seconds: value.response_seconds === "" ? null : value.response_seconds,
    max_attempts: value.max_attempts === "" ? null : value.max_attempts,
    is_required: value.is_required ?? false,
  });
  if (error) {
    if (error.message.toLowerCase().includes("unique") || error.code === "23505") {
      return { ok: false, error: "Another question was added at the same time. Please retry." };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath(`/recruiter/interview-templates/${templateId}`);
  return { ok: true };
}

export async function updateQuestionAction(formData: FormData): Promise<InterviewActionResult> {
  const templateId = text(formData.get("template_id"));
  const questionId = text(formData.get("question_id"));
  const scoped = await scopedTemplate(templateId);
  if (!scoped) return { ok: false, error: "Template not found or not authorized." };
  const { data: question } = await scoped.context.supabase
    .from("interview_template_questions")
    .select("id")
    .eq("id", questionId)
    .eq("template_id", templateId)
    .maybeSingle();
  if (!question) return { ok: false, error: "Question not found." };
  const parsed = interviewQuestionSchema.safeParse({
    question_text: text(formData.get("question_text")),
    guidance: text(formData.get("guidance")),
    preparation_seconds: text(formData.get("preparation_seconds")),
    response_seconds: text(formData.get("response_seconds")),
    max_attempts: text(formData.get("max_attempts")),
    is_required: formData.get("is_required") === "on",
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid question." };
  const value = parsed.data;
  const { error } = await scoped.context.supabase
    .from("interview_template_questions")
    .update({
      question_text: value.question_text,
      guidance: value.guidance || null,
      preparation_seconds: value.preparation_seconds === "" ? null : value.preparation_seconds,
      response_seconds: value.response_seconds === "" ? null : value.response_seconds,
      max_attempts: value.max_attempts === "" ? null : value.max_attempts,
      is_required: value.is_required ?? false,
    })
    .eq("id", questionId)
    .eq("template_id", templateId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/recruiter/interview-templates/${templateId}`);
  return { ok: true };
}

export async function removeQuestionAction(formData: FormData): Promise<InterviewActionResult> {
  const templateId = text(formData.get("template_id"));
  const questionId = text(formData.get("question_id"));
  const scoped = await scopedTemplate(templateId);
  if (!scoped) return { ok: false, error: "Template not found or not authorized." };
  const { data: question } = await scoped.context.supabase
    .from("interview_template_questions")
    .select("id")
    .eq("id", questionId)
    .eq("template_id", templateId)
    .maybeSingle();
  if (!question) return { ok: false, error: "Question not found." };
  const { error } = await scoped.context.supabase
    .from("interview_template_questions")
    .delete()
    .eq("id", questionId)
    .eq("template_id", templateId);
  if (error) return { ok: false, error: error.message };
  const { data: remaining } = await scoped.context.supabase
    .from("interview_template_questions")
    .select("id")
    .eq("template_id", templateId)
    .order("display_order");
  const remainingIds = ((remaining as { id: string }[] | null) ?? []).map((q) => q.id);
  const reorderError = await reorderQuestions(scoped.context.supabase, remainingIds);
  if (reorderError) return { ok: false, error: reorderError };
  revalidatePath(`/recruiter/interview-templates/${templateId}`);
  return { ok: true };
}

async function reorderQuestions(
  supabase: ReturnType<typeof createClient>,
  questionIds: string[],
): Promise<string | null> {
  for (let index = 0; index < questionIds.length; index += 1) {
    const { error } = await supabase
      .from("interview_template_questions")
      .update({ display_order: 1000 + index })
      .eq("id", questionIds[index]!);
    if (error) return error.message;
  }
  for (let index = 0; index < questionIds.length; index += 1) {
    const { error } = await supabase
      .from("interview_template_questions")
      .update({ display_order: index + 1 })
      .eq("id", questionIds[index]!);
    if (error) return error.message;
  }
  return null;
}

export async function reorderQuestionsAction(formData: FormData): Promise<InterviewActionResult> {
  const templateId = text(formData.get("template_id"));
  const questionIds = text(formData.get("question_ids")).split(",").filter(Boolean);
  const scoped = await scopedTemplate(templateId);
  if (!scoped) return { ok: false, error: "Template not found or not authorized." };
  const { data } = await scoped.context.supabase
    .from("interview_template_questions")
    .select("id")
    .eq("template_id", templateId);
  const allowed = new Set(((data as { id: string }[] | null) ?? []).map((q) => q.id));
  if (questionIds.length !== allowed.size || questionIds.some((id) => !allowed.has(id))) {
    return { ok: false, error: "Invalid question order." };
  }
  const error = await reorderQuestions(scoped.context.supabase, questionIds);
  if (error) return { ok: false, error };
  revalidatePath(`/recruiter/interview-templates/${templateId}`);
  return { ok: true };
}

export async function createAssignmentAction(formData: FormData): Promise<InterviewActionResult> {
  const parsed = interviewAssignmentSchema.safeParse({
    application_id: text(formData.get("application_id")),
    template_id: text(formData.get("template_id")),
    expires_at: text(formData.get("expires_at")),
    candidate_instructions: text(formData.get("candidate_instructions")),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid assignment." };
  const expiresAtIso = endOfLocalDayIso(parsed.data.expires_at);
  if (!expiresAtIso) return { ok: false, error: "The deadline is invalid." };
  const expiresAt = new Date(expiresAtIso);
  if (expiresAt <= new Date()) {
    return { ok: false, error: "The deadline must be in the future." };
  }

  // Resolve the application first so template org matches the owning franchise,
  // not an arbitrary staff membership (important for HQ multi-membership users).
  const bootstrap = await staffContext();
  if (!bootstrap) return { ok: false, error: "Not signed in or not authorized." };
  const { data: appData } = await bootstrap.supabase
    .from("applications")
    .select("*")
    .eq("id", parsed.data.application_id)
    .maybeSingle();
  const application = appData as ApplicationRow | null;
  if (!application) return { ok: false, error: "Application not found or not authorized." };
  const context = await staffContext(application.owning_org_id);
  if (!context || context.orgId !== application.owning_org_id) {
    return { ok: false, error: "Application not found or not authorized." };
  }
  const { data: templateData } = await context.supabase
    .from("interview_templates")
    .select("*")
    .eq("id", parsed.data.template_id)
    .eq("organization_id", application.owning_org_id)
    .eq("is_active", true)
    .maybeSingle();
  const template = templateData as InterviewTemplateRow | null;
  if (!template) {
    return { ok: false, error: "Application or template not found in your organization." };
  }

  const { data: completedExisting } = await context.supabase
    .from("interview_assignments")
    .select("id")
    .eq("application_id", application.id)
    .in("status", ["submitted", "reviewed"])
    .limit(1);
  if (completedExisting?.length) {
    return {
      ok: false,
      error: "This candidate already completed a video interview for this application.",
    };
  }

  const { data: questionsData } = await context.supabase
    .from("interview_template_questions")
    .select("*")
    .eq("template_id", template.id)
    .order("display_order");
  const questions = (questionsData as InterviewTemplateQuestionRow[] | null) ?? [];
  if (!questions.length)
    return { ok: false, error: "Add at least one question before assigning this template." };
  const { data: assignmentData, error } = await context.supabase
    .from("interview_assignments")
    .insert({
      template_id: template.id,
      candidate_id: application.candidate_id,
      application_id: application.id,
      job_order_id: application.job_order_id,
      organization_id: application.owning_org_id,
      assigned_by: context.userId,
      status: "invited",
      invited_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      candidate_instructions: parsed.data.candidate_instructions || null,
      template_name_snapshot: template.name,
      template_instructions_snapshot: template.instructions,
      retention_days: template.retention_days,
      allow_pause_between_questions: template.allow_pause_between_questions,
      allow_response_review: template.allow_response_review,
      expiration_grace_hours: template.expiration_grace_hours,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  const assignment = assignmentData as InterviewAssignmentRow;
  const snapshots = questions.map((question) => ({
    assignment_id: assignment.id,
    source_template_question_id: question.id,
    question_text_snapshot: question.question_text,
    question_description_snapshot: question.guidance,
    display_order: question.display_order,
    preparation_seconds: question.preparation_seconds ?? template.default_preparation_seconds,
    response_seconds: question.response_seconds ?? template.default_response_seconds,
    max_attempts: question.max_attempts ?? template.default_max_attempts,
    is_required: question.is_required,
  }));
  const { error: snapshotError } = await context.supabase
    .from("interview_assignment_questions")
    .insert(snapshots);
  if (snapshotError) {
    const { error: deleteError } = await context.supabase
      .from("interview_assignments")
      .delete()
      .eq("id", assignment.id);
    return {
      ok: false,
      error: deleteError
        ? `${snapshotError.message} (also failed to roll back assignment)`
        : snapshotError.message,
    };
  }
  const [{ data: candidate }, { data: job }] = await Promise.all([
    context.supabase
      .from("candidate_profiles")
      .select("user_id")
      .eq("id", application.candidate_id)
      .maybeSingle(),
    context.supabase
      .from("job_orders")
      .select("title")
      .eq("id", application.job_order_id)
      .maybeSingle(),
  ]);
  const candidateUserId = (candidate as { user_id: string } | null)?.user_id;
  if (candidateUserId) {
    await context.supabase.from("notifications").insert({
      user_id: candidateUserId,
      category: "interview",
      title: "Video interview invitation",
      body: `You have been invited to complete a video interview${(job as { title: string } | null)?.title ? ` for ${(job as { title: string }).title}` : ""}.`,
      subject_type: "interview_assignment",
      subject_id: assignment.id,
    });
  }
  revalidatePath(`/recruiter/applications/${application.id}`);
  revalidatePath("/recruiter/interviews");
  return { ok: true, id: assignment.id };
}

export async function cancelAssignmentAction(formData: FormData): Promise<InterviewActionResult> {
  const assignmentId = text(formData.get("assignment_id"));
  const scoped = await scopedAssignment(assignmentId);
  if (!scoped) return { ok: false, error: "Interview not found or not authorized." };
  if (!["draft", "invited", "in_progress"].includes(scoped.assignment.status)) {
    return { ok: false, error: "This interview can no longer be cancelled." };
  }
  const { data: cancelled, error } = await scoped.context.supabase
    .from("interview_assignments")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .in("status", ["draft", "invited", "in_progress"])
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!cancelled) {
    return { ok: false, error: "This interview can no longer be cancelled." };
  }
  revalidatePath(`/recruiter/applications/${scoped.assignment.application_id}`);
  revalidatePath(`/recruiter/interviews/${assignmentId}`);
  revalidatePath("/recruiter/interviews");
  return { ok: true };
}

/** Create an in-app deadline reminder; the RPC prevents repeats within 24h. */
export async function sendInterviewReminderAction(
  formData: FormData,
): Promise<InterviewActionResult> {
  const assignmentId = text(formData.get("assignment_id"));
  const scoped = await scopedAssignment(assignmentId);
  if (!scoped) return { ok: false, error: "Interview not found or not authorized." };
  const { data, error } = await scoped.context.supabase.rpc("send_interview_deadline_reminder", {
    p_assignment_id: assignmentId,
  });
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "A reminder was already sent in the last 24 hours." };
  return { ok: true };
}

export async function saveReviewAction(formData: FormData): Promise<InterviewActionResult> {
  const parsed = interviewReviewSchema.safeParse({
    assignment_id: text(formData.get("assignment_id")),
    overall_rating: text(formData.get("overall_rating")),
    internal_notes: text(formData.get("internal_notes")),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid review." };
  const scoped = await scopedAssignment(parsed.data.assignment_id);
  if (!scoped) return { ok: false, error: "Interview not found or not authorized." };
  if (!["submitted", "reviewed"].includes(scoped.assignment.status)) {
    return { ok: false, error: "Only submitted interviews can be reviewed." };
  }
  const { error } = await scoped.context.supabase.from("interview_reviews").upsert(
    {
      assignment_id: scoped.assignment.id,
      recruiter_id: scoped.context.userId,
      overall_rating: parsed.data.overall_rating === "" ? null : parsed.data.overall_rating,
      internal_notes: parsed.data.internal_notes || null,
    },
    { onConflict: "assignment_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/recruiter/interviews/${scoped.assignment.id}`);
  return { ok: true };
}

export async function markReviewedAction(formData: FormData): Promise<InterviewActionResult> {
  const parsed = interviewReviewSchema.safeParse({
    assignment_id: text(formData.get("assignment_id")),
    overall_rating: text(formData.get("overall_rating")),
    internal_notes: text(formData.get("internal_notes")),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid review." };
  const scoped = await scopedAssignment(parsed.data.assignment_id);
  if (!scoped) return { ok: false, error: "Interview not found or not authorized." };
  if (!["submitted", "reviewed"].includes(scoped.assignment.status)) {
    return { ok: false, error: "Only submitted interviews can be reviewed." };
  }
  const now = new Date().toISOString();
  const { data: assignmentUpdated, error: assignmentError } = await scoped.context.supabase
    .from("interview_assignments")
    .update({ status: "reviewed", reviewed_at: now, reviewed_by: scoped.context.userId })
    .eq("id", scoped.assignment.id)
    .in("status", ["submitted", "reviewed"])
    .select("id")
    .maybeSingle();
  if (assignmentError) return { ok: false, error: assignmentError.message };
  if (!assignmentUpdated) {
    return { ok: false, error: "Only submitted interviews can be reviewed." };
  }
  const { error } = await scoped.context.supabase.from("interview_reviews").upsert(
    {
      assignment_id: scoped.assignment.id,
      recruiter_id: scoped.context.userId,
      overall_rating: parsed.data.overall_rating === "" ? null : parsed.data.overall_rating,
      internal_notes: parsed.data.internal_notes || null,
      review_status: "reviewed",
    },
    { onConflict: "assignment_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/recruiter/interviews/${scoped.assignment.id}`);
  revalidatePath("/recruiter/interviews");
  return { ok: true };
}

export async function getPlaybackUrlAction(attemptId: string): Promise<InterviewActionResult> {
  const context = await staffContext();
  if (!context) return { ok: false, error: "Not signed in or not authorized." };
  const { data } = await context.supabase
    .from("interview_response_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("upload_status", "uploaded")
    .maybeSingle();
  const attempt = data as InterviewResponseAttemptRow | null;
  if (!attempt) return { ok: false, error: "Recording not found or not authorized." };
  const { data: assignment } = await context.supabase
    .from("interview_assignments")
    .select("id")
    .eq("id", attempt.assignment_id)
    .maybeSingle();
  if (!assignment) return { ok: false, error: "Recording not found or not authorized." };

  const folder = attempt.storage_path.slice(0, attempt.storage_path.lastIndexOf("/"));
  const filename = attempt.storage_path.slice(attempt.storage_path.lastIndexOf("/") + 1);
  const { data: objects, error: listError } = await context.supabase.storage
    .from(attempt.storage_bucket)
    .list(folder, { search: filename });
  if (listError || !objects?.some((object) => object.name === filename)) {
    return { ok: false, error: "Recording unavailable." };
  }

  const { data: signed, error } = await context.supabase.storage
    .from(attempt.storage_bucket)
    .createSignedUrl(attempt.storage_path, 120);
  if (error || !signed?.signedUrl)
    return { ok: false, error: error?.message ?? "Recording unavailable." };
  return { ok: true, url: signed.signedUrl };
}
