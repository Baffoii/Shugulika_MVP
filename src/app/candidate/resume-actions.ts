"use server";

/**
 * CV/resume upload → autofill review workflow. Candidate-profile only — never
 * used by the job application flow. Parsing runs entirely server-side (Node
 * runtime; do not add `export const runtime = "edge"` near these actions,
 * pdf-parse/mammoth require Node). Extracted data is NEVER written directly
 * to profile tables — it only ever produces resume_field_suggestions rows
 * that the candidate must explicitly accept, edit, or reject.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_TYPES } from "@/lib/constants";
import { isResumeParsingConfigured } from "@/lib/env";
import {
  candidateProfileSchema,
  experienceSchema,
  educationSchema,
  certificationSchema,
  languageSchema,
  normalizeLanguageProficiency,
} from "@/lib/validation";
import { extractResumeText, UnsupportedResumeFileError } from "@/lib/resume/extract-text";
import { extractResumeFields, ResumeExtractionError } from "@/lib/resume/extract-fields";
import { extractResumeFieldsStub } from "@/lib/resume/extract-fields-stub";
import {
  generateProfessionalCopy,
  mergeProfessionalCopyIntoPersonal,
  resumeLacksProfessionalSummary,
} from "@/lib/resume/generate-professional-copy";
import { aiError, aiLog, aiWarn } from "@/lib/ai-cost-log";
import type { ResumeExtraction } from "@/lib/resume/extraction-schema";
import {
  matchExperience,
  matchEducation,
  matchCertification,
  matchLanguage,
} from "@/lib/resume-suggestions";
import type {
  CandidateProfileRow,
  CandidateExperienceRow,
  CandidateEducationRow,
  CandidateSkillRow,
  CandidateCertificationRow,
  CandidateLanguageRow,
  CandidateDocumentRow,
  Json,
  ResumeFieldSuggestionRow,
  ResumeSuggestionTargetEntity,
} from "@/lib/database.types";
import type { ActionResult } from "@/app/candidate/actions";

const CV_CONFIG = DOCUMENT_TYPES.find((d) => d.key === "cv")!;

async function myCandidateId(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.from("candidate_profiles").select("id").maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

interface SuggestionInsert {
  target_entity: ResumeSuggestionTargetEntity;
  target_entity_id: string | null;
  field_path: string;
  suggested_value: Json;
  current_value: Json | null;
  confidence: number;
  evidence_text: string | null;
}

function buildProfileSuggestions(
  profile: CandidateProfileRow,
  personal: ResumeExtraction["personal"],
  currentPhone: string | null,
): SuggestionInsert[] {
  const rows: SuggestionInsert[] = [];
  const push = (
    field:
      | "given_name"
      | "middle_name"
      | "family_name"
      | "phone"
      | "email"
      | "headline"
      | "summary"
      | "city"
      | "availability"
      | "country_code",
    current: string | null,
    extracted: { value: string; confidence: number; evidence_text: string | null } | null,
  ) => {
    if (!extracted || !extracted.value.trim()) return;
    const extractedVal = extracted.value.trim();
    // Only suggest when the CV actually says something different from what's
    // already on file — a field already having a value never means the
    // suggestion is auto-applied (the candidate must always explicitly
    // Accept/Edit/Reject it), but it also must not be silently hidden just
    // because a value already exists there.
    if (current && current.trim().toLowerCase() === extractedVal.toLowerCase()) return;
    rows.push({
      target_entity: "profile",
      target_entity_id: profile.id,
      field_path: field,
      suggested_value: extractedVal,
      current_value: current ?? null,
      confidence: extracted.confidence,
      evidence_text: extracted.evidence_text,
    });
  };
  push("given_name", profile.given_name, personal.given_name);
  push("middle_name", profile.middle_name, personal.middle_name);
  push("family_name", profile.family_name, personal.family_name);
  push("phone", currentPhone, personal.phone);
  // Compare against contact_email (not Auth sign-in email).
  push("email", profile.contact_email, personal.email);
  push("headline", profile.headline, personal.headline);
  push("summary", profile.summary, personal.summary);
  push("city", profile.city, personal.city);
  push("availability", profile.availability, personal.availability);
  push("country_code", profile.country_code, personal.country_code);
  return rows;
}

function buildExperienceSuggestions(
  existing: CandidateExperienceRow[],
  items: ResumeExtraction["experience"],
): SuggestionInsert[] {
  return items
    .filter((item) => item.title.trim())
    .map((item) => {
      const matchId = matchExperience(existing, {
        title: item.title,
        employer_name: item.employer_name,
      });
      const matched = matchId ? (existing.find((e) => e.id === matchId) ?? null) : null;
      return {
        target_entity: "experience" as const,
        target_entity_id: matchId,
        field_path: "item",
        suggested_value: {
          title: item.title,
          employer_name: item.employer_name,
          location: item.location,
          start_date: item.start_date,
          end_date: item.is_current ? null : item.end_date,
          is_current: item.is_current,
          description: item.description,
        },
        current_value: matched
          ? {
              title: matched.title,
              employer_name: matched.employer_name,
              location: matched.location,
              start_date: matched.start_date,
              end_date: matched.end_date,
              is_current: matched.is_current,
              description: matched.description,
            }
          : null,
        confidence: item.confidence,
        evidence_text: item.evidence_text,
      };
    });
}

function buildEducationSuggestions(
  existing: CandidateEducationRow[],
  items: ResumeExtraction["education"],
): SuggestionInsert[] {
  return items
    .filter((item) => item.institution.trim())
    .map((item) => {
      const matchId = matchEducation(existing, {
        institution: item.institution,
        qualification: item.qualification,
      });
      const matched = matchId ? (existing.find((e) => e.id === matchId) ?? null) : null;
      return {
        target_entity: "education" as const,
        target_entity_id: matchId,
        field_path: "item",
        suggested_value: {
          institution: item.institution,
          qualification: item.qualification,
          field_of_study: item.field_of_study,
          start_date: item.start_date,
          end_date: item.is_current ? null : item.end_date,
          is_current: item.is_current,
        },
        current_value: matched
          ? {
              institution: matched.institution,
              qualification: matched.qualification,
              field_of_study: matched.field_of_study,
              start_date: matched.start_date,
              end_date: matched.end_date,
              is_current: matched.is_current,
            }
          : null,
        confidence: item.confidence,
        evidence_text: item.evidence_text,
      };
    });
}

function buildSkillSuggestions(
  existing: CandidateSkillRow[],
  items: ResumeExtraction["skills"],
): SuggestionInsert[] {
  const existingNames = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  return items
    .filter((item) => item.name.trim() && !existingNames.has(item.name.trim().toLowerCase()))
    .map((item) => ({
      target_entity: "skill" as const,
      target_entity_id: null,
      field_path: "item",
      suggested_value: { name: item.name },
      current_value: null,
      confidence: item.confidence,
      evidence_text: item.evidence_text,
    }));
}

function buildCertificationSuggestions(
  existing: CandidateCertificationRow[],
  items: ResumeExtraction["certifications"],
): SuggestionInsert[] {
  return items
    .filter((item) => item.name.trim())
    .map((item) => {
      const matchId = matchCertification(existing, { name: item.name, issuer: item.issuer });
      const matched = matchId ? (existing.find((e) => e.id === matchId) ?? null) : null;
      return {
        target_entity: "certification" as const,
        target_entity_id: matchId,
        field_path: "item",
        suggested_value: { name: item.name, issuer: item.issuer, issued_on: item.issued_on },
        current_value: matched
          ? { name: matched.name, issuer: matched.issuer, issued_on: matched.issued_on }
          : null,
        confidence: item.confidence,
        evidence_text: item.evidence_text,
      };
    });
}

function buildLanguageSuggestions(
  existing: CandidateLanguageRow[],
  items: ResumeExtraction["languages"],
): SuggestionInsert[] {
  return items
    .filter((item) => item.language.trim())
    .map((item) => {
      const matchId = matchLanguage(existing, { language: item.language });
      const matched = matchId ? (existing.find((e) => e.id === matchId) ?? null) : null;
      return {
        target_entity: "language" as const,
        target_entity_id: matchId,
        field_path: "item",
        suggested_value: {
          language: item.language,
          proficiency: normalizeLanguageProficiency(item.proficiency) || item.proficiency,
        },
        current_value: matched
          ? { language: matched.language, proficiency: matched.proficiency }
          : null,
        confidence: item.confidence,
        evidence_text: item.evidence_text,
      };
    });
}

/**
 * Kicks off CV analysis: validates ownership + file type/size and writes the
 * "queued"/"failed" status synchronously (a couple of fast Supabase round
 * trips), then returns. The caller MUST await this before calling
 * router.refresh(), otherwise the page can re-render before any status row
 * exists and the polling UI never engages. The slow work (download, text
 * extraction, AI/rule-based extraction, writing suggestions) is kicked off
 * separately via continueResumeParse — see parseResumeAction below.
 */
async function startResumeParse(
  documentId: string,
): Promise<
  | { ok: true; runId: string; document: CandidateDocumentRow; usingAi: boolean }
  | { ok: false; error: string }
> {
  const supabase = createClient();
  const cid = await myCandidateId(supabase);
  if (!cid) return { ok: false, error: "No candidate profile" };

  const { data: docData } = await supabase
    .from("candidate_documents")
    .select("*")
    .eq("id", documentId)
    .eq("candidate_id", cid)
    .maybeSingle();
  const document = docData as CandidateDocumentRow | null;
  if (!document || document.doc_type !== "cv") {
    return { ok: false, error: "CV document not found." };
  }

  // When no OpenAI key is configured, fall back to a free, deterministic,
  // regex-based extractor so the review workflow works with zero setup/cost.
  const usingAi = isResumeParsingConfigured();
  aiLog("resume", "PARSE_START", {
    documentId,
    candidateId: cid,
    usingAi,
    billed: usingAi,
    tip: usingAi
      ? "OPENAI_API_KEY set — field extraction will bill OpenAI"
      : "No OpenAI key — free rule-based stub only",
  });

  const { data: runData, error: runErr } = await supabase
    .from("resume_parse_runs")
    .insert({
      candidate_id: cid,
      document_id: document.id,
      status: "queued",
      provider: usingAi ? "openai" : "rule_based",
    })
    .select("id")
    .single();
  if (runErr || !runData) {
    aiError("resume", "PARSE_RUN_INSERT_FAILED", runErr, { documentId });
    return {
      ok: false,
      error: runErr?.message.includes("does not exist")
        ? "CV analysis isn't set up yet — the database migration for resume parsing hasn't been run. See supabase/migrations/0006_cv_parse_suggestions.sql."
        : "Could not start CV analysis. Please try again.",
    };
  }
  const runId = (runData as { id: string }).id;

  await supabase
    .from("candidate_documents")
    .update({ parse_status: "queued" })
    .eq("id", document.id);

  const extension = `.${document.object_path.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!CV_CONFIG.accept.split(",").includes(extension)) {
    const message = `Unsupported file type for CV analysis. Please upload ${CV_CONFIG.accept.replaceAll(",", ", ")}.`;
    await failRun(supabase, runId, document.id, message);
    return { ok: false, error: message };
  }
  if (document.size_bytes && document.size_bytes > CV_CONFIG.maxMb * 1024 * 1024) {
    const message = `This CV is larger than the ${CV_CONFIG.maxMb} MB analysis limit.`;
    await failRun(supabase, runId, document.id, message);
    return { ok: false, error: message };
  }

  return { ok: true, runId, document, usingAi };
}

async function failRun(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  documentId: string,
  message: string,
): Promise<void> {
  console.error(`[resume-actions] run ${runId} failed: ${message}`);
  aiError("resume", "PARSE_RUN_FAILED", undefined, { runId, documentId, message });
  await supabase
    .from("resume_parse_runs")
    .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
    .eq("id", runId);
  await supabase
    .from("candidate_documents")
    .update({ parse_status: "failed" })
    .eq("id", documentId);
  revalidatePath("/candidate/profile");
}

/**
 * Does the slow work (download, text extraction, AI/rule-based extraction,
 * writing suggestions) for a run already created by startResumeParse. Meant
 * to be called fire-and-forget (not awaited) after the caller has already
 * awaited startResumeParse and refreshed the page.
 */
async function continueResumeParse(
  runId: string,
  document: CandidateDocumentRow,
  usingAi: boolean,
): Promise<void> {
  const supabase = createClient();
  const cid = await myCandidateId(supabase);
  if (!cid) {
    aiWarn("resume", "BACKGROUND_ABORT", { runId, reason: "no_candidate_id" });
    return;
  }

  const parseStartedAt = Date.now();
  aiLog("resume", "BACKGROUND_START", {
    runId,
    documentId: document.id,
    usingAi,
    billed: usingAi,
  });

  const fail = (message: string) => failRun(supabase, runId, document.id, message);

  try {
    await supabase
      .from("resume_parse_runs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", runId);
    await supabase
      .from("candidate_documents")
      .update({ parse_status: "processing" })
      .eq("id", document.id);

    const { data: fileBlob, error: downloadErr } = await supabase.storage
      .from(document.bucket_id)
      .download(document.object_path);
    if (downloadErr || !fileBlob) {
      aiError("resume", "CV_DOWNLOAD_FAILED", downloadErr, { runId });
      return await fail("Could not read the uploaded CV file. Please try re-uploading it.");
    }
    aiLog("resume", "CV_DOWNLOAD_OK", { runId, blobBytes: fileBlob.size });

    let resumeText: string;
    try {
      const buffer = Buffer.from(await fileBlob.arrayBuffer());
      const extractStarted = Date.now();
      resumeText = await extractResumeText(buffer, document.object_path);
      aiLog("resume", "CV_TEXT_EXTRACTED", {
        runId,
        cvChars: resumeText.length,
        extractMs: Date.now() - extractStarted,
        freeLocalStep: true,
      });
    } catch (error) {
      aiError("resume", "CV_TEXT_EXTRACT_FAILED", error, { runId });
      if (error instanceof UnsupportedResumeFileError) {
        return await fail(
          `Unsupported file type for CV analysis. Please upload ${CV_CONFIG.accept.replaceAll(",", ", ")}.`,
        );
      }
      return await fail(
        "We couldn't extract text from this file. Try a different PDF or DOCX export of your CV.",
      );
    }

    if (resumeText.length < 30) {
      aiWarn("resume", "CV_TEXT_TOO_SHORT", { runId, cvChars: resumeText.length });
      return await fail(
        "This file doesn't appear to contain readable text (it may be a scanned image). Try a text-based PDF or DOCX.",
      );
    }

    let extraction: ResumeExtraction;
    try {
      if (usingAi) {
        aiLog("resume", "ABOUT_TO_BILL_OPENAI", {
          runId,
          tip: "Next logs are OPENAI_REQUEST_PREPARE / CALL_START — credits will be used",
        });
        extraction = await extractResumeFields(resumeText);
      } else {
        aiLog("resume", "USING_FREE_STUB", { runId, billed: false });
        extraction = extractResumeFieldsStub(resumeText);
      }
    } catch (error) {
      aiError("resume", "FIELD_EXTRACTION_FAILED", error, { runId, usingAi });
      if (error instanceof ResumeExtractionError) return await fail(error.message);
      return await fail(
        usingAi
          ? "The AI provider could not analyze this CV. Please try again."
          : "We couldn't analyze this CV with the free extractor. Please try again.",
      );
    }

    const [
      { data: profileData },
      { data: expData },
      { data: eduData },
      { data: skillData },
      { data: certData },
      { data: langData },
    ] = await Promise.all([
      supabase.from("candidate_profiles").select("*").eq("id", cid).maybeSingle(),
      supabase.from("candidate_experiences").select("*").eq("candidate_id", cid),
      supabase.from("candidate_education").select("*").eq("candidate_id", cid),
      supabase.from("candidate_skills").select("*").eq("candidate_id", cid),
      supabase.from("candidate_certifications").select("*").eq("candidate_id", cid),
      supabase.from("candidate_languages").select("*").eq("candidate_id", cid),
    ]);
    const profile = profileData as CandidateProfileRow | null;
    if (!profile) return await fail("Your candidate profile could not be loaded.");

    // Phone lives on the shared `profiles` row; contact_email lives on
    // candidate_profiles (independent of Auth sign-in email).
    const { data: accountData } = await supabase
      .from("profiles")
      .select("phone")
      .eq("id", profile.user_id)
      .maybeSingle();
    const currentPhone = (accountData as { phone: string | null } | null)?.phone ?? null;

    // Second OpenAI call (same resume model): draft headline + summary only
    // when the CV itself had no professional summary. Failures are non-fatal —
    // other extracted suggestions still save.
    if (usingAi && resumeLacksProfessionalSummary(extraction.personal.summary)) {
      aiLog("resume", "PROFESSIONAL_COPY_NEEDED", {
        runId,
        tip: "CV had no summary — drafting headline/summary via OpenAI",
      });
      try {
        const drafted = await generateProfessionalCopy(resumeText);
        const merged = mergeProfessionalCopyIntoPersonal({
          personal: extraction.personal,
          profileHeadline: profile.headline,
          profileSummary: profile.summary,
          drafted,
        });
        extraction.personal.headline = merged.headline;
        extraction.personal.summary = merged.summary;
        aiLog("resume", "PROFESSIONAL_COPY_APPLIED", {
          runId,
          filled: merged.filled,
          billed: true,
        });
      } catch (error) {
        aiWarn("resume", "PROFESSIONAL_COPY_SKIPPED", {
          runId,
          reason: error instanceof Error ? error.message : "unknown",
          tip: "Parse continues without AI-drafted summary/headline",
        });
      }
    } else {
      aiLog("resume", "PROFESSIONAL_COPY_SKIPPED", {
        runId,
        reason: usingAi ? "cv_already_has_summary" : "openai_not_configured",
        billed: false,
      });
    }

    const profileSuggestions = buildProfileSuggestions(profile, extraction.personal, currentPhone);
    const suggestions: SuggestionInsert[] = [
      ...profileSuggestions,
      ...buildExperienceSuggestions(
        (expData as CandidateExperienceRow[] | null) ?? [],
        extraction.experience,
      ),
      ...buildEducationSuggestions(
        (eduData as CandidateEducationRow[] | null) ?? [],
        extraction.education,
      ),
      ...buildSkillSuggestions((skillData as CandidateSkillRow[] | null) ?? [], extraction.skills),
      ...buildCertificationSuggestions(
        (certData as CandidateCertificationRow[] | null) ?? [],
        extraction.certifications,
      ),
      ...buildLanguageSuggestions(
        (langData as CandidateLanguageRow[] | null) ?? [],
        extraction.languages,
      ),
    ];

    // Diagnostic only — logs field NAMES and counts, never PII/values, so
    // it's safe to leave on and is invaluable when a candidate's resume
    // layout doesn't match the free extractor's heuristics.
    aiLog("resume", "EXTRACTION_SUMMARY", {
      runId,
      usingAi,
      personalFieldsExtracted: Object.entries(extraction.personal)
        .filter(([, v]) => v !== null)
        .map(([k]) => k),
      personalFieldsAlreadyFilled: {
        given_name: !!profile.given_name,
        middle_name: !!profile.middle_name,
        family_name: !!profile.family_name,
        phone: !!currentPhone,
        email: !!profile.contact_email,
        headline: !!profile.headline,
        summary: !!profile.summary,
        city: !!profile.city,
        country_code: !!profile.country_code,
        availability: !!profile.availability,
      },
      profileSuggestionsCreated: profileSuggestions.map((s) => s.field_path),
      experienceCount: extraction.experience.length,
      educationCount: extraction.education.length,
      skillCount: extraction.skills.length,
      suggestionCount: suggestions.length,
    });

    if (suggestions.length > 0) {
      const { error: insertErr } = await supabase
        .from("resume_field_suggestions")
        .insert(suggestions.map((s) => ({ ...s, parse_run_id: runId, candidate_id: cid })));
      if (insertErr) {
        aiError("resume", "SUGGESTION_INSERT_FAILED", insertErr, { runId });
        return await fail(
          "We analyzed your CV but couldn't save the suggestions. Please try again.",
        );
      }
    }

    await supabase
      .from("resume_parse_runs")
      .update({
        status: "succeeded",
        model: usingAi ? (process.env.OPENAI_RESUME_MODEL ?? "gpt-4.1-mini") : "rule-based-v1",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    await supabase
      .from("candidate_documents")
      .update({ parse_status: "succeeded" })
      .eq("id", document.id);

    aiLog("resume", "PARSE_SUCCEEDED", {
      runId,
      usingAi,
      suggestionCount: suggestions.length,
      totalBackgroundMs: Date.now() - parseStartedAt,
      billed: usingAi,
    });

    revalidatePath("/candidate/profile");
  } catch (error) {
    aiError("resume", "BACKGROUND_UNEXPECTED", error, { runId });
    await fail("Something unexpected went wrong while analyzing your CV. Please try again.");
  }
}

/**
 * Parses an already-uploaded CV document and writes candidate-review
 * suggestions. Never throws — every failure path marks the run/document as
 * failed with a candidate-safe message. Callers should `await` this call
 * (it only awaits the fast "start" phase) before refreshing the page, so the
 * page's initial render reflects "queued"/"failed" instead of racing ahead
 * of the very first database write.
 */
export async function parseResumeAction(documentId: string): Promise<ActionResult> {
  const started = await startResumeParse(documentId);
  if (!started.ok) return { ok: false, error: started.error };
  void continueResumeParse(started.runId, started.document, started.usingAi);
  return { ok: true };
}

async function getOwnedPendingSuggestion(
  supabase: ReturnType<typeof createClient>,
  cid: string,
  id: string,
): Promise<ResumeFieldSuggestionRow | null> {
  const { data } = await supabase
    .from("resume_field_suggestions")
    .select("*")
    .eq("id", id)
    .eq("candidate_id", cid)
    .maybeSingle();
  return (data as ResumeFieldSuggestionRow | null) ?? null;
}

/**
 * Accepts (optionally edited via formData) a suggestion and writes it to the
 * canonical profile table. Idempotent: resolving an already-resolved
 * suggestion returns a friendly error instead of double-writing.
 */
export async function acceptSuggestionAction(
  id: string,
  formData?: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const cid = await myCandidateId(supabase);
  if (!cid) return { ok: false, error: "No candidate profile" };

  const suggestion = await getOwnedPendingSuggestion(supabase, cid, id);
  if (!suggestion) return { ok: false, error: "Suggestion not found." };
  if (suggestion.status !== "pending")
    return { ok: false, error: "This suggestion has already been resolved." };

  const edited = !!formData;
  const resolvedAt = new Date().toISOString();
  const markResolved = async (status: "accepted" | "edited") => {
    await supabase
      .from("resume_field_suggestions")
      .update({ status, resolved_at: resolvedAt })
      .eq("id", id);
    revalidatePath("/candidate/profile");
  };

  if (suggestion.target_entity === "profile") {
    const field = suggestion.field_path as
      | "given_name"
      | "middle_name"
      | "family_name"
      | "phone"
      | "email"
      | "headline"
      | "summary"
      | "city"
      | "availability"
      | "country_code";
    const value = edited
      ? String(formData!.get("value") ?? "")
      : String(suggestion.suggested_value ?? "");
    const fieldSchema = candidateProfileSchema.shape[field];
    const parsed = fieldSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        fieldErrors: { value: parsed.error.issues[0]?.message ?? "Invalid value" },
      };

    if (field === "phone") {
      // Phone lives on the shared `profiles` row, not candidate_profiles.
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return { ok: false, error: "Not signed in." };
      const { error } = await supabase
        .from("profiles")
        .update({ phone: value || null })
        .eq("id", userData.user.id);
      if (error) return { ok: false, error: error.message };
    } else if (field === "email") {
      // Contact email on the candidate profile — independent of Auth sign-in.
      // Suggestions write here directly; they never change login identity.
      const { error } = await supabase
        .from("candidate_profiles")
        .update({ contact_email: value || null })
        .eq("id", cid);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase
        .from("candidate_profiles")
        .update({ [field]: value || null })
        .eq("id", cid);
      if (error) return { ok: false, error: error.message };
    }
    await markResolved(edited ? "edited" : "accepted");
    return { ok: true };
  }

  if (suggestion.target_entity === "experience") {
    const suggested = suggestion.suggested_value as {
      title: string;
      employer_name: string | null;
      location: string | null;
      start_date: string | null;
      end_date: string | null;
      is_current: boolean;
      description: string | null;
    };
    const values = edited
      ? {
          title: String(formData!.get("title") ?? ""),
          employer_name: String(formData!.get("employer_name") ?? ""),
          location: String(formData!.get("location") ?? ""),
          start_date: String(formData!.get("start_date") ?? ""),
          end_date: String(formData!.get("end_date") ?? ""),
          is_current: formData!.get("is_current") === "on",
          description: String(formData!.get("description") ?? ""),
        }
      : {
          title: suggested.title,
          employer_name: suggested.employer_name ?? "",
          location: suggested.location ?? "",
          start_date: suggested.start_date ?? "",
          end_date: suggested.end_date ?? "",
          is_current: suggested.is_current,
          description: suggested.description ?? "",
        };
    const parsed = experienceSchema.safeParse(values);
    if (!parsed.success)
      return {
        ok: false,
        fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
          (a, i) => ({ ...a, [i.path.join(".")]: i.message }),
          {},
        ),
      };
    const payload = {
      title: values.title,
      employer_name: values.employer_name || null,
      location: values.location || null,
      start_date: values.start_date || null,
      end_date: values.is_current ? null : values.end_date || null,
      is_current: values.is_current,
      description: values.description || null,
    };
    const { error } = suggestion.target_entity_id
      ? await supabase
          .from("candidate_experiences")
          .update(payload)
          .eq("id", suggestion.target_entity_id)
          .eq("candidate_id", cid)
      : await supabase.from("candidate_experiences").insert({ ...payload, candidate_id: cid });
    if (error) return { ok: false, error: error.message };
    await markResolved(edited ? "edited" : "accepted");
    return { ok: true };
  }

  if (suggestion.target_entity === "education") {
    const suggested = suggestion.suggested_value as {
      institution: string;
      qualification: string | null;
      field_of_study: string | null;
      start_date: string | null;
      end_date: string | null;
      is_current: boolean;
    };
    const values = edited
      ? {
          institution: String(formData!.get("institution") ?? ""),
          qualification: String(formData!.get("qualification") ?? ""),
          field_of_study: String(formData!.get("field_of_study") ?? ""),
          start_date: String(formData!.get("start_date") ?? ""),
          end_date: String(formData!.get("end_date") ?? ""),
          is_current: formData!.get("is_current") === "on",
        }
      : {
          institution: suggested.institution,
          qualification: suggested.qualification ?? "",
          field_of_study: suggested.field_of_study ?? "",
          start_date: suggested.start_date ?? "",
          end_date: suggested.end_date ?? "",
          is_current: suggested.is_current,
        };
    const parsed = educationSchema.safeParse(values);
    if (!parsed.success)
      return {
        ok: false,
        fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
          (a, i) => ({ ...a, [i.path.join(".")]: i.message }),
          {},
        ),
      };
    const payload = {
      institution: values.institution,
      qualification: values.qualification || null,
      field_of_study: values.field_of_study || null,
      start_date: values.start_date || null,
      end_date: values.is_current ? null : values.end_date || null,
      is_current: values.is_current,
    };
    const { error } = suggestion.target_entity_id
      ? await supabase
          .from("candidate_education")
          .update(payload)
          .eq("id", suggestion.target_entity_id)
          .eq("candidate_id", cid)
      : await supabase.from("candidate_education").insert({ ...payload, candidate_id: cid });
    if (error) return { ok: false, error: error.message };
    await markResolved(edited ? "edited" : "accepted");
    return { ok: true };
  }

  if (suggestion.target_entity === "skill") {
    const suggested = suggestion.suggested_value as { name: string };
    const name = edited ? String(formData!.get("name") ?? "") : suggested.name;
    if (!name.trim()) return { ok: false, fieldErrors: { name: "Required" } };
    const { error } = await supabase
      .from("candidate_skills")
      .insert({ candidate_id: cid, name: name.trim() });
    if (error) return { ok: false, error: error.message };
    await markResolved(edited ? "edited" : "accepted");
    return { ok: true };
  }

  if (suggestion.target_entity === "certification") {
    const suggested = suggestion.suggested_value as {
      name: string;
      issuer: string | null;
      issued_on: string | null;
    };
    const values = edited
      ? {
          name: String(formData!.get("name") ?? ""),
          issuer: String(formData!.get("issuer") ?? ""),
          issued_on: String(formData!.get("issued_on") ?? ""),
        }
      : {
          name: suggested.name,
          issuer: suggested.issuer ?? "",
          issued_on: suggested.issued_on ?? "",
        };
    const parsed = certificationSchema.safeParse(values);
    if (!parsed.success)
      return {
        ok: false,
        fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
          (a, i) => ({ ...a, [i.path.join(".")]: i.message }),
          {},
        ),
      };
    const payload = {
      name: values.name,
      issuer: values.issuer || null,
      issued_on: values.issued_on || null,
    };
    const { error } = suggestion.target_entity_id
      ? await supabase
          .from("candidate_certifications")
          .update(payload)
          .eq("id", suggestion.target_entity_id)
          .eq("candidate_id", cid)
      : await supabase.from("candidate_certifications").insert({ ...payload, candidate_id: cid });
    if (error) return { ok: false, error: error.message };
    await markResolved(edited ? "edited" : "accepted");
    return { ok: true };
  }

  if (suggestion.target_entity === "language") {
    const suggested = suggestion.suggested_value as {
      language: string;
      proficiency: string | null;
    };
    const values = edited
      ? {
          language: String(formData!.get("language") ?? ""),
          proficiency: String(formData!.get("proficiency") ?? ""),
        }
      : { language: suggested.language, proficiency: suggested.proficiency ?? "" };
    const parsed = languageSchema.safeParse(values);
    if (!parsed.success)
      return {
        ok: false,
        fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
          (a, i) => ({ ...a, [i.path.join(".")]: i.message }),
          {},
        ),
      };
    const payload = {
      language: parsed.data.language,
      proficiency: parsed.data.proficiency || null,
    };
    let targetId = suggestion.target_entity_id;
    if (!targetId) {
      const { data: existingLangs } = await supabase
        .from("candidate_languages")
        .select("id, language")
        .eq("candidate_id", cid);
      targetId = matchLanguage(existingLangs ?? [], { language: payload.language });
    }
    const { error } = targetId
      ? await supabase
          .from("candidate_languages")
          .update(payload)
          .eq("id", targetId)
          .eq("candidate_id", cid)
      : await supabase.from("candidate_languages").insert({ ...payload, candidate_id: cid });
    if (error) return { ok: false, error: error.message };
    await markResolved(edited ? "edited" : "accepted");
    return { ok: true };
  }

  return { ok: false, error: "Unknown suggestion type." };
}

export async function rejectSuggestionAction(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const cid = await myCandidateId(supabase);
  if (!cid) return { ok: false, error: "No candidate profile" };

  const suggestion = await getOwnedPendingSuggestion(supabase, cid, id);
  if (!suggestion) return { ok: false, error: "Suggestion not found." };
  if (suggestion.status !== "pending")
    return { ok: false, error: "This suggestion has already been resolved." };

  const { error } = await supabase
    .from("resume_field_suggestions")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/profile");
  return { ok: true };
}
