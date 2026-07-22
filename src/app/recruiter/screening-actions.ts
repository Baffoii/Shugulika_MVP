"use server";

/**
 * AI CV screening (role-fit review) — recruiter/staff only. On-demand: a review
 * row is created ONLY when a recruiter triggers it, never automatically on
 * application insert (cost control #1). Results are cached on the review row and
 * reused while the CV and the job's requirement set are unchanged (cost control
 * #2), and each fresh run is metered against the employer's
 * `ai_cv_screens_per_period` entitlement.
 *
 * Runs entirely server-side (Node runtime — pdf-parse/mammoth are not
 * Edge-compatible; never add `export const runtime = "edge"` near these
 * actions). Reviews are never candidate-visible (enforced by RLS).
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, rolesCanAccessPortal } from "@/lib/auth";
import { isResumeParsingConfigured, env } from "@/lib/env";
import { extractResumeText, UnsupportedResumeFileError } from "@/lib/resume/extract-text";
import {
  scoreApplication,
  requirementsFingerprint,
  ScreeningError,
  type ScreeningRequirement,
  type ScreeningAnswer,
} from "@/lib/screening/score-application";
import { aiError, aiLog, aiWarn } from "@/lib/ai-cost-log";
import type {
  ApplicationRow,
  JobOrderRow,
  JobRequirementRow,
  CandidateDocumentRow,
  ApplicationAiReviewRow,
  JobScreeningQuestionRow,
  ApplicationAnswerRow,
  EmployerSubscriptionRow,
  Json,
} from "@/lib/database.types";

export interface ScreenActionResult {
  ok: boolean;
  error?: string;
  /** Id of the review row to poll / display. */
  reviewId?: string;
  /** True when an existing succeeded review was reused instead of a new run. */
  cached?: boolean;
}

const ENTITLEMENT_KEY = "ai_cv_screens_per_period";

/** Maps the stored requirement rows to the scoring module's input shape. */
function toScreeningRequirements(rows: JobRequirementRow[]): ScreeningRequirement[] {
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    label: r.label,
    detail: r.detail,
    importance: r.importance,
    min_years: r.min_years,
  }));
}

/** Renders a screening answer's JSON value to a short readable string. */
function answerToText(answer: Json): string {
  if (answer == null) return "";
  if (typeof answer === "string") return answer;
  if (typeof answer === "number" || typeof answer === "boolean") return String(answer);
  if (Array.isArray(answer)) return answer.map(answerToText).filter(Boolean).join(", ");
  return JSON.stringify(answer);
}

/**
 * Entitlement gate. Blocks a NEW run once the employer has used up its
 * `ai_cv_screens_per_period` allowance for the current cycle (anchored on the
 * active subscription's `starts_on`). No active subscription / no configured
 * limit ⇒ treated as unlimited for this MVP.
 */
async function checkEntitlement(
  supabase: ReturnType<typeof createClient>,
  employerOrgId: string,
): Promise<{ allowed: boolean; error?: string }> {
  const { data: subData } = await supabase
    .from("employer_subscriptions")
    .select("*")
    .eq("employer_org_id", employerOrgId)
    .in("status", ["active", "trial"])
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sub = subData as EmployerSubscriptionRow | null;
  if (!sub) {
    aiLog("screening", "ENTITLEMENT_UNMETERED", {
      employerOrgId,
      reason: "no_active_subscription",
    });
    return { allowed: true }; // MVP: no subscription ⇒ unmetered
  }

  const { data: entData } = await supabase
    .from("package_entitlements")
    .select("limit_value")
    .eq("package_id", sub.package_id)
    .eq("key", ENTITLEMENT_KEY)
    .maybeSingle();
  const limit = (entData as { limit_value: number | null } | null)?.limit_value ?? null;
  if (limit == null) {
    aiLog("screening", "ENTITLEMENT_UNMETERED", {
      employerOrgId,
      reason: "no_limit_configured",
      packageId: sub.package_id,
    });
    return { allowed: true }; // no limit configured ⇒ unlimited
  }

  const { data: used, error } = await supabase.rpc("ai_cv_screens_used", {
    p_employer_org: employerOrgId,
    p_since: sub.starts_on,
  });
  if (error) {
    aiError("screening", "ENTITLEMENT_LOOKUP_FAILED", error, { employerOrgId, limit });
    // Fail closed: a metering outage must not become free OpenAI spend.
    return {
      allowed: false,
      error: "Could not verify AI screening allowance. Please try again shortly.",
    };
  }
  const usedCount = used ?? 0;
  aiLog("screening", "ENTITLEMENT_CHECK", {
    employerOrgId,
    used: usedCount,
    limit,
    remaining: Math.max(0, limit - usedCount),
  });
  if (usedCount >= limit) {
    aiWarn("screening", "ENTITLEMENT_EXHAUSTED", { employerOrgId, used: usedCount, limit });
    return {
      allowed: false,
      error: `This employer has used all ${limit} AI CV screens for the current billing cycle.`,
    };
  }
  return { allowed: true };
}

/**
 * Triggers an AI screen of an application's CV against its job requirements.
 * Fast phase only (validation, cache/entitlement checks, queued-row insert) is
 * awaited; the slow OpenAI work runs fire-and-forget and the UI polls the
 * review row. Never throws — every failure returns a recruiter-safe message.
 */
export async function screenApplicationAction(
  applicationId: string,
  opts: { force?: boolean } = {},
): Promise<ScreenActionResult> {
  const actionStarted = Date.now();
  aiLog("screening", "ACTION_START", {
    applicationId,
    force: !!opts.force,
    openaiConfigured: isResumeParsingConfigured(),
    model: isResumeParsingConfigured() ? env.openaiScreeningModel() : null,
  });

  const supabase = createClient();
  // Defense in depth: server actions are callable outside the recruiter layout.
  // Only recruiter-portal staff may trigger paid OpenAI screens (not candidates
  // or employer users — even if they can see the application via RLS).
  const session = await getSessionContext();
  if (!session) {
    aiWarn("screening", "ACTION_REJECTED", { reason: "not_signed_in", applicationId });
    return { ok: false, error: "Not signed in." };
  }
  if (!rolesCanAccessPortal(session.roles, "recruiter")) {
    aiWarn("screening", "ACTION_REJECTED", {
      reason: "role_denied",
      roles: session.roles,
      applicationId,
    });
    return { ok: false, error: "You don’t have permission to run AI screening." };
  }
  const uid = session.userId;
  if (!isResumeParsingConfigured()) {
    aiWarn("screening", "ACTION_REJECTED", { reason: "no_openai_key", applicationId });
    return { ok: false, error: "AI screening isn't configured (no OpenAI key set)." };
  }

  // RLS ensures only staff who can see this application get a row back.
  const { data: appData } = await supabase
    .from("applications")
    .select("*")
    .eq("id", applicationId)
    .maybeSingle();
  const app = appData as ApplicationRow | null;
  if (!app) {
    aiWarn("screening", "ACTION_REJECTED", { reason: "application_not_found", applicationId });
    return { ok: false, error: "Application not found." };
  }
  aiLog("screening", "APPLICATION_LOADED", {
    applicationId,
    jobOrderId: app.job_order_id,
    hasPinnedCv: !!app.cv_document_id,
    candidateId: app.candidate_id,
  });

  // Screen the CV attached to the application; fall back to the candidate's
  // primary active CV when the application didn't pin a specific document.
  let cvDocumentId = app.cv_document_id;
  if (!cvDocumentId) {
    const { data: cvDoc } = await supabase
      .from("candidate_documents")
      .select("id")
      .eq("candidate_id", app.candidate_id)
      .eq("doc_type", "cv")
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    cvDocumentId = (cvDoc as { id: string } | null)?.id ?? null;
    aiLog("screening", "CV_FALLBACK_LOOKUP", {
      applicationId,
      found: !!cvDocumentId,
      cvDocumentId,
    });
  }
  if (!cvDocumentId) {
    aiWarn("screening", "ACTION_REJECTED", { reason: "no_cv", applicationId });
    return { ok: false, error: "This application has no CV attached to screen." };
  }

  const { data: joData } = await supabase
    .from("job_orders")
    .select("*")
    .eq("id", app.job_order_id)
    .maybeSingle();
  const jobOrder = joData as JobOrderRow | null;
  if (!jobOrder) {
    aiWarn("screening", "ACTION_REJECTED", { reason: "job_order_not_found", applicationId });
    return { ok: false, error: "Job order not found." };
  }

  const { data: reqData } = await supabase
    .from("job_requirements")
    .select("*")
    .eq("job_order_id", app.job_order_id)
    .order("ordinal", { ascending: true });
  const requirements = (reqData as JobRequirementRow[] | null) ?? [];
  const fingerprint = requirementsFingerprint(toScreeningRequirements(requirements));
  aiLog("screening", "REQUIREMENTS_LOADED", {
    jobTitle: jobOrder.title,
    jobOrderId: jobOrder.id,
    employerOrgId: jobOrder.employer_org_id,
    requirementCount: requirements.length,
    fingerprintPrefix: fingerprint.slice(0, 12),
  });

  // Reuse an in-flight run so a double click doesn't spawn two screens.
  const { data: existing } = await supabase
    .from("application_ai_reviews")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latest = existing as ApplicationAiReviewRow | null;
  if (latest && (latest.status === "queued" || latest.status === "processing")) {
    aiLog("screening", "REUSE_IN_FLIGHT", {
      reviewId: latest.id,
      status: latest.status,
      billed: false,
      tip: "No new OpenAI call — attaching to existing run",
    });
    return { ok: true, reviewId: latest.id };
  }
  // Cache hit: a succeeded review for the SAME CV and SAME requirement set.
  if (
    !opts.force &&
    latest &&
    latest.status === "succeeded" &&
    latest.cv_document_id === cvDocumentId &&
    latest.requirements_fingerprint === fingerprint
  ) {
    aiLog("screening", "CACHE_HIT_FREE", {
      reviewId: latest.id,
      applicationId,
      billed: false,
      tip: "$0 — reused prior succeeded review (same CV + requirements)",
      elapsedMs: Date.now() - actionStarted,
    });
    return { ok: true, reviewId: latest.id, cached: true };
  }

  if (opts.force) {
    aiWarn("screening", "FORCE_RESREEN", {
      applicationId,
      previousReviewId: latest?.id ?? null,
      previousStatus: latest?.status ?? null,
      tip: "Force bypasses cache — this WILL bill OpenAI if the run proceeds",
    });
  } else if (latest?.status === "succeeded") {
    aiLog("screening", "CACHE_MISS", {
      reason:
        latest.cv_document_id !== cvDocumentId
          ? "cv_changed"
          : latest.requirements_fingerprint !== fingerprint
            ? "requirements_changed"
            : "unknown",
      previousReviewId: latest.id,
    });
  }

  // Cost control: meter fresh runs against the employer's entitlement.
  const gate = await checkEntitlement(supabase, jobOrder.employer_org_id);
  if (!gate.allowed) {
    aiWarn("screening", "ACTION_REJECTED", { reason: "entitlement", error: gate.error });
    return { ok: false, error: gate.error };
  }

  const model = env.openaiScreeningModel();
  const { data: runData, error: runErr } = await supabase
    .from("application_ai_reviews")
    .insert({
      application_id: applicationId,
      job_order_id: app.job_order_id,
      status: "queued",
      provider: "openai",
      model,
      cv_document_id: cvDocumentId,
      requirements_fingerprint: fingerprint,
      created_by: uid,
    })
    .select("id")
    .single();
  if (runErr || !runData) {
    aiError("screening", "REVIEW_ROW_INSERT_FAILED", runErr, { applicationId });
    return { ok: false, error: "Could not start the AI screen. Please try again." };
  }
  const reviewId = (runData as { id: string }).id;
  aiLog("screening", "REVIEW_QUEUED", {
    reviewId,
    applicationId,
    model,
    cvDocumentId,
    billed: true,
    tip: "Background continueScreening will call OpenAI — watch CALL_START / CALL_COMPLETE",
    elapsedMs: Date.now() - actionStarted,
  });

  void continueScreening(reviewId);
  return { ok: true, reviewId };
}

async function failReview(
  supabase: ReturnType<typeof createClient>,
  reviewId: string,
  message: string,
): Promise<void> {
  aiError("screening", "REVIEW_FAILED", undefined, { reviewId, message });
  await supabase
    .from("application_ai_reviews")
    .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
    .eq("id", reviewId);
  revalidatePath("/recruiter/pipeline");
}

/**
 * Slow phase for a queued review: download CV → extract text → score against
 * requirements → persist items + summary. Fire-and-forget; never throws.
 */
async function continueScreening(reviewId: string): Promise<void> {
  const bgStarted = Date.now();
  aiLog("screening", "BACKGROUND_START", { reviewId });
  const supabase = createClient();
  const fail = (message: string) => failReview(supabase, reviewId, message);

  try {
    const { data: reviewData } = await supabase
      .from("application_ai_reviews")
      .select("*")
      .eq("id", reviewId)
      .maybeSingle();
    const review = reviewData as ApplicationAiReviewRow | null;
    if (!review) {
      aiWarn("screening", "BACKGROUND_ABORT", { reviewId, reason: "review_row_missing" });
      return;
    }

    await supabase
      .from("application_ai_reviews")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", reviewId);
    aiLog("screening", "STATUS_PROCESSING", {
      reviewId,
      applicationId: review.application_id,
      model: review.model,
    });

    const [{ data: appData }, { data: joData }, { data: reqData }] = await Promise.all([
      supabase.from("applications").select("*").eq("id", review.application_id).maybeSingle(),
      supabase.from("job_orders").select("*").eq("id", review.job_order_id).maybeSingle(),
      supabase
        .from("job_requirements")
        .select("*")
        .eq("job_order_id", review.job_order_id)
        .order("ordinal", { ascending: true }),
    ]);
    const app = appData as ApplicationRow | null;
    const jobOrder = joData as JobOrderRow | null;
    const requirements = (reqData as JobRequirementRow[] | null) ?? [];
    if (!app || !jobOrder) return await fail("The application or job order could not be loaded.");
    if (!review.cv_document_id) return await fail("This application has no CV attached to screen.");

    const { data: docData } = await supabase
      .from("candidate_documents")
      .select("*")
      .eq("id", review.cv_document_id)
      .maybeSingle();
    const doc = docData as CandidateDocumentRow | null;
    if (!doc) return await fail("The candidate's CV document could not be found.");
    aiLog("screening", "CV_DOC_LOADED", {
      reviewId,
      bucketId: doc.bucket_id,
      sizeBytes: doc.size_bytes,
      mimeType: doc.mime_type,
      // path basename only — avoid logging full storage paths with user ids
      fileName: doc.object_path.split("/").pop() ?? null,
    });

    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from(doc.bucket_id)
      .download(doc.object_path);
    if (dlErr || !fileBlob) {
      aiError("screening", "CV_DOWNLOAD_FAILED", dlErr, { reviewId });
      return await fail("Could not read the candidate's CV file.");
    }
    aiLog("screening", "CV_DOWNLOAD_OK", {
      reviewId,
      blobBytes: fileBlob.size,
    });

    let cvText: string;
    try {
      const buffer = Buffer.from(await fileBlob.arrayBuffer());
      const extractStarted = Date.now();
      cvText = await extractResumeText(buffer, doc.object_path);
      aiLog("screening", "CV_TEXT_EXTRACTED", {
        reviewId,
        cvChars: cvText.length,
        extractMs: Date.now() - extractStarted,
        freeLocalStep: true,
      });
    } catch (error) {
      aiError("screening", "CV_TEXT_EXTRACT_FAILED", error, { reviewId });
      if (error instanceof UnsupportedResumeFileError) {
        return await fail("The CV file type is not supported for screening (use PDF or DOCX).");
      }
      return await fail("We couldn't extract text from the CV (it may be a scanned image).");
    }
    if (cvText.trim().length < 30) {
      aiWarn("screening", "CV_TEXT_TOO_SHORT", { reviewId, cvChars: cvText.length });
      return await fail("The CV has no readable text to screen (it may be a scanned image).");
    }

    // Screening Q&A for extra signal.
    const { data: ansData } = await supabase
      .from("application_answers")
      .select("*")
      .eq("application_id", review.application_id);
    const answerRows = (ansData as ApplicationAnswerRow[] | null) ?? [];
    let questionMap = new Map<string, string>();
    if (answerRows.some((a) => a.question_id)) {
      const { data: qData } = await supabase
        .from("job_screening_questions")
        .select("id, prompt")
        .eq("job_order_id", review.job_order_id);
      questionMap = new Map(
        ((qData as Pick<JobScreeningQuestionRow, "id" | "prompt">[] | null) ?? []).map((q) => [
          q.id,
          q.prompt,
        ]),
      );
    }
    const answers: ScreeningAnswer[] = answerRows
      .map((a) => ({
        prompt: a.prompt ?? (a.question_id ? (questionMap.get(a.question_id) ?? "") : ""),
        answer: answerToText(a.answer),
      }))
      .filter((a) => a.prompt && a.answer);
    aiLog("screening", "ANSWERS_LOADED", {
      reviewId,
      answerCount: answers.length,
      requirementCount: requirements.length,
    });

    let result;
    try {
      aiLog("screening", "ABOUT_TO_BILL_OPENAI", {
        reviewId,
        jobTitle: jobOrder.title,
        tip: "Next log lines are OPENAI_REQUEST_PREPARE / CALL_START — credits will be used",
      });
      result = await scoreApplication({
        jobTitle: jobOrder.title,
        requirements: toScreeningRequirements(requirements),
        freeTextRequirements: jobOrder.requirements,
        cvText,
        answers,
      });
    } catch (error) {
      if (error instanceof ScreeningError) return await fail(error.message);
      return await fail("The AI provider could not screen this CV. Please try again.");
    }

    // Persist per-item breakdown. Only echo a requirement_id we actually sent
    // (guards the FK against a hallucinated id).
    const knownReqIds = new Set(requirements.map((r) => r.id));
    if (result.items.length > 0) {
      const itemRows = result.items.map((item, index) => ({
        review_id: reviewId,
        requirement_id:
          item.requirement_id && knownReqIds.has(item.requirement_id) ? item.requirement_id : null,
        item_type: item.item_type,
        label: item.label,
        assessment: item.assessment,
        explanation: item.explanation,
        evidence_text: item.evidence_text,
        confidence: item.confidence,
        ordinal: index,
      }));
      const { error: itemErr } = await supabase
        .from("application_ai_review_items")
        .insert(itemRows);
      if (itemErr) {
        aiError("screening", "ITEMS_INSERT_FAILED", itemErr, { reviewId });
        return await fail("We screened the CV but couldn't save the breakdown. Please try again.");
      }
      aiLog("screening", "ITEMS_PERSISTED", { reviewId, itemCount: itemRows.length });
    }

    await supabase
      .from("application_ai_reviews")
      .update({
        status: "succeeded",
        overall_score: result.overall_score,
        fit_verdict: result.fit_verdict,
        summary: result.summary,
        strengths: result.strengths,
        concerns: result.concerns,
        recommended_questions: result.recommended_questions as Json,
        model_reasoning: result.model_reasoning,
        completed_at: new Date().toISOString(),
      })
      .eq("id", reviewId);

    aiLog("screening", "REVIEW_SUCCEEDED", {
      reviewId,
      applicationId: review.application_id,
      overallScore: result.overall_score,
      fitVerdict: result.fit_verdict,
      totalBackgroundMs: Date.now() - bgStarted,
      tip: "Re-open same app without Force = CACHE_HIT_FREE ($0)",
    });

    revalidatePath("/recruiter/pipeline");
    revalidatePath(`/recruiter/applications/${review.application_id}`);
  } catch (error) {
    aiError("screening", "BACKGROUND_UNEXPECTED", error, { reviewId });
    await fail("Something unexpected went wrong while screening this CV. Please try again.");
  }
}
