"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  candidateProfileSchema,
  experienceSchema,
  educationSchema,
  certificationSchema,
  languageSchema,
} from "@/lib/validation";
import type { JobScreeningQuestionRow, Json } from "@/lib/database.types";

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Optional success-path message (e.g. "confirmation email sent") — distinct from `error`, which is only for failures. */
  message?: string;
}

async function myCandidateId(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.from("candidate_profiles").select("id").maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function updateProfileAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const values = {
    given_name: String(formData.get("given_name") ?? ""),
    middle_name: String(formData.get("middle_name") ?? ""),
    family_name: String(formData.get("family_name") ?? ""),
    headline: String(formData.get("headline") ?? ""),
    summary: String(formData.get("summary") ?? ""),
    country_code: String(formData.get("country_code") ?? ""),
    city: String(formData.get("city") ?? ""),
    availability: String(formData.get("availability") ?? ""),
    open_to_work: formData.get("open_to_work") === "on",
    phone: String(formData.get("phone") ?? ""),
    // Contact email on the candidate profile — not the Auth sign-in email.
    email: String(formData.get("email") ?? ""),
  };
  const parsed = candidateProfileSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
        (a, i) => ({ ...a, [i.path.join(".")]: i.message }),
        {},
      ),
    };
  }
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { error } = await supabase
    .from("candidate_profiles")
    .update({
      given_name: values.given_name,
      middle_name: values.middle_name || null,
      family_name: values.family_name || null,
      contact_email: values.email || null,
      headline: values.headline || null,
      summary: values.summary || null,
      country_code: values.country_code || null,
      city: values.city || null,
      availability: values.availability || null,
      open_to_work: values.open_to_work,
      profile_status: "active",
    })
    .eq("id", cid);
  if (error) return { ok: false, error: error.message };

  // Phone lives on the shared `profiles` row (same one used by every portal),
  // not on candidate_profiles — update it separately.
  if (userData.user) {
    const { error: phoneError } = await supabase
      .from("profiles")
      .update({ phone: values.phone || null })
      .eq("id", userData.user.id);
    if (phoneError) return { ok: false, error: phoneError.message };
  }

  revalidatePath("/candidate/profile");
  revalidatePath("/candidate/dashboard");
  return { ok: true };
}

export async function addExperienceAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    title: String(formData.get("title") ?? ""),
    employer_name: String(formData.get("employer_name") ?? ""),
    location: String(formData.get("location") ?? ""),
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    is_current: formData.get("is_current") === "on",
    description: String(formData.get("description") ?? ""),
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
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { error } = await supabase.from("candidate_experiences").insert({
    candidate_id: cid,
    title: values.title,
    employer_name: values.employer_name || null,
    location: values.location || null,
    start_date: values.start_date || null,
    end_date: values.is_current ? null : values.end_date || null,
    is_current: values.is_current,
    description: values.description || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function addEducationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    institution: String(formData.get("institution") ?? ""),
    qualification: String(formData.get("qualification") ?? ""),
    field_of_study: String(formData.get("field_of_study") ?? ""),
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    is_current: formData.get("is_current") === "on",
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
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { error } = await supabase.from("candidate_education").insert({
    candidate_id: cid,
    institution: values.institution,
    qualification: values.qualification || null,
    field_of_study: values.field_of_study || null,
    start_date: values.start_date || null,
    end_date: values.is_current ? null : values.end_date || null,
    is_current: values.is_current,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function updateExperienceAction(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    title: String(formData.get("title") ?? ""),
    employer_name: String(formData.get("employer_name") ?? ""),
    location: String(formData.get("location") ?? ""),
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    is_current: formData.get("is_current") === "on",
    description: String(formData.get("description") ?? ""),
  };
  const parsed = experienceSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
        (errors, issue) => ({ ...errors, [issue.path.join(".")]: issue.message }),
        {},
      ),
    };
  }
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { data, error } = await supabase
    .from("candidate_experiences")
    .update({
      title: values.title,
      employer_name: values.employer_name || null,
      location: values.location || null,
      start_date: values.start_date || null,
      end_date: values.is_current ? null : values.end_date || null,
      is_current: values.is_current,
      description: values.description || null,
    })
    .eq("id", id)
    .eq("candidate_id", cid)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Work experience not found." };
  revalidatePath("/candidate/profile");
  revalidatePath("/candidate/dashboard");
  return { ok: true };
}

export async function updateEducationAction(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    institution: String(formData.get("institution") ?? ""),
    qualification: String(formData.get("qualification") ?? ""),
    field_of_study: String(formData.get("field_of_study") ?? ""),
    start_date: String(formData.get("start_date") ?? ""),
    end_date: String(formData.get("end_date") ?? ""),
    is_current: formData.get("is_current") === "on",
  };
  const parsed = educationSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
        (errors, issue) => ({ ...errors, [issue.path.join(".")]: issue.message }),
        {},
      ),
    };
  }
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { data, error } = await supabase
    .from("candidate_education")
    .update({
      institution: values.institution,
      qualification: values.qualification || null,
      field_of_study: values.field_of_study || null,
      start_date: values.start_date || null,
      end_date: values.is_current ? null : values.end_date || null,
      is_current: values.is_current,
    })
    .eq("id", id)
    .eq("candidate_id", cid)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Education record not found." };
  revalidatePath("/candidate/profile");
  revalidatePath("/candidate/dashboard");
  return { ok: true };
}

export async function addCertificationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    name: String(formData.get("name") ?? ""),
    issuer: String(formData.get("issuer") ?? ""),
    issued_on: String(formData.get("issued_on") ?? ""),
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
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { error } = await supabase.from("candidate_certifications").insert({
    candidate_id: cid,
    name: values.name,
    issuer: values.issuer || null,
    issued_on: values.issued_on || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function updateCertificationAction(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    name: String(formData.get("name") ?? ""),
    issuer: String(formData.get("issuer") ?? ""),
    issued_on: String(formData.get("issued_on") ?? ""),
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
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { data, error } = await supabase
    .from("candidate_certifications")
    .update({
      name: values.name,
      issuer: values.issuer || null,
      issued_on: values.issued_on || null,
    })
    .eq("id", id)
    .eq("candidate_id", cid)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Certification not found." };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function addLanguageAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    language: String(formData.get("language") ?? ""),
    proficiency: String(formData.get("proficiency") ?? ""),
  };
  const parsed = languageSchema.safeParse(values);
  if (!parsed.success)
    return {
      ok: false,
      fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
        (a, i) => ({ ...a, [i.path.join(".")]: i.message }),
        {},
      ),
    };
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { error } = await supabase.from("candidate_languages").insert({
    candidate_id: cid,
    language: values.language,
    proficiency: values.proficiency || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function updateLanguageAction(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    language: String(formData.get("language") ?? ""),
    proficiency: String(formData.get("proficiency") ?? ""),
  };
  const parsed = languageSchema.safeParse(values);
  if (!parsed.success)
    return {
      ok: false,
      fieldErrors: parsed.error.issues.reduce<Record<string, string>>(
        (a, i) => ({ ...a, [i.path.join(".")]: i.message }),
        {},
      ),
    };
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { data, error } = await supabase
    .from("candidate_languages")
    .update({ language: values.language, proficiency: values.proficiency || null })
    .eq("id", id)
    .eq("candidate_id", cid)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Language not found." };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function addSkillAction(name: string): Promise<ActionResult> {
  const supabase = createClient();
  const cid = await myCandidateId();
  if (!cid || !name.trim()) return { ok: false, error: "Invalid" };
  const { error } = await supabase
    .from("candidate_skills")
    .insert({ candidate_id: cid, name: name.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function deleteRowAction(
  table:
    | "candidate_experiences"
    | "candidate_education"
    | "candidate_skills"
    | "candidate_certifications"
    | "candidate_languages",
  id: string,
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function toggleSaveJobAction(jobId: string): Promise<ActionResult> {
  const supabase = createClient();
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { data: existing } = await supabase
    .from("saved_jobs")
    .select("id")
    .eq("candidate_id", cid)
    .eq("job_id", jobId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("saved_jobs")
      .delete()
      .eq("id", (existing as { id: string }).id);
  } else {
    await supabase.from("saved_jobs").insert({ candidate_id: cid, job_id: jobId });
  }
  revalidatePath("/candidate/saved-jobs");
  return { ok: true };
}

/** Apply to a job order: creates the application, a granular consent record,
 *  a stage-history row, and a candidate notification. Consent is explicit. */
export async function applyToJobAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = createClient();
  const jobOrderId = String(formData.get("job_order_id") ?? "");
  const cvDocumentId = String(formData.get("cv_document_id") ?? "") || null;
  const consentShare = formData.get("consent_share") === "on";
  const consentProcess = formData.get("consent_process") === "on";
  const accurate = formData.get("accurate") === "on";

  if (!consentProcess || !consentShare)
    return { ok: false, error: "Both required consents must be given to submit." };
  if (!accurate) return { ok: false, error: "Please confirm your information is accurate." };

  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };

  const { data: joData, error: joErr } = await supabase
    .from("apply_targets")
    .select("job_order_id,responsible_org_id,recruitment_path")
    .eq("job_order_id", jobOrderId)
    .maybeSingle();
  const jo = joData as {
    job_order_id: string;
    responsible_org_id: string;
    recruitment_path: "A" | "B";
  } | null;
  if (joErr || !jo) return { ok: false, error: "This role is no longer available." };

  // Existing application (unique on candidate_id + job_order_id). Resubmit updates
  // it rather than blocking — candidates confirm in the UI first.
  const { data: existingApp } = await supabase
    .from("applications")
    .select("id")
    .eq("candidate_id", cid)
    .eq("job_order_id", jobOrderId)
    .maybeSingle();
  const isResubmit = Boolean(existingApp);
  const confirmedResubmit = formData.get("reapply") === "1";
  if (isResubmit && !confirmedResubmit) {
    return {
      ok: false,
      error: "You've already applied to this role. Use Apply again if you want to resubmit.",
    };
  }

  // Load screening questions and validate answers before creating/updating the application.
  const { data: questionRows } = await supabase
    .from("job_screening_questions")
    .select("*")
    .eq("job_order_id", jobOrderId)
    .order("ordinal");
  const questions = (questionRows as JobScreeningQuestionRow[] | null) ?? [];
  const answerFieldErrors: Record<string, string> = {};
  const parsedAnswers: { question_id: string; prompt: string; answer: Json }[] = [];

  for (const q of questions) {
    const key = `answer_${q.id}`;
    let answer: Json = null;

    if (q.qtype === "multi_choice") {
      const selected = formData.getAll(key).map(String).filter(Boolean);
      if (q.is_required && selected.length === 0) {
        answerFieldErrors[key] = "Please select at least one option.";
        continue;
      }
      answer = selected;
    } else {
      const raw = String(formData.get(key) ?? "").trim();
      if (q.is_required && !raw) {
        answerFieldErrors[key] = "This question is required.";
        continue;
      }
      if (!raw) continue;

      if (q.qtype === "boolean") {
        if (raw !== "true" && raw !== "false") {
          answerFieldErrors[key] = "Please choose Yes or No.";
          continue;
        }
        answer = raw === "true";
      } else if (q.qtype === "numeric") {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          answerFieldErrors[key] = "Enter a valid number.";
          continue;
        }
        answer = n;
      } else {
        answer = raw;
      }
    }

    parsedAnswers.push({ question_id: q.id, prompt: q.prompt, answer });
  }

  if (Object.keys(answerFieldErrors).length > 0) {
    return {
      ok: false,
      fieldErrors: answerFieldErrors,
      error: "Please answer the required questions.",
    };
  }

  let applicationId: string;
  if (isResubmit && existingApp) {
    applicationId = (existingApp as { id: string }).id;
    const { error: updErr } = await supabase
      .from("applications")
      .update({
        cv_document_id: cvDocumentId,
        withdrawn_at: null,
        current_stage: "applied_sourced",
        consent_status: "granted",
      })
      .eq("id", applicationId);
    if (updErr) return { ok: false, error: updErr.message };

    // Replace prior screening answers for this application.
    await supabase.from("application_answers").delete().eq("application_id", applicationId);
    if (parsedAnswers.length > 0) {
      const { error: answersErr } = await supabase.from("application_answers").insert(
        parsedAnswers.map((a) => ({
          application_id: applicationId,
          question_id: a.question_id,
          prompt: a.prompt,
          answer: a.answer,
        })),
      );
      if (answersErr) return { ok: false, error: answersErr.message };
    }
  } else {
    const { data: appData, error: appErr } = await supabase
      .from("applications")
      .insert({
        candidate_id: cid,
        job_order_id: jobOrderId,
        owning_org_id: jo.responsible_org_id,
        recruitment_path: jo.recruitment_path,
        entry_source: "applied_direct",
        current_stage: "applied_sourced",
        consent_status: "granted",
        cv_document_id: cvDocumentId,
      })
      .select("id")
      .single();
    if (appErr || !appData)
      return { ok: false, error: appErr?.message ?? "Could not submit application." };
    applicationId = (appData as { id: string }).id;

    if (parsedAnswers.length > 0) {
      const { error: answersErr } = await supabase.from("application_answers").insert(
        parsedAnswers.map((a) => ({
          application_id: applicationId,
          question_id: a.question_id,
          prompt: a.prompt,
          answer: a.answer,
        })),
      );
      if (answersErr) {
        // Roll back the application so the candidate can resubmit with answers.
        await supabase.from("applications").delete().eq("id", applicationId);
        return { ok: false, error: answersErr.message };
      }
    }
  }

  // Granular, timestamped consent records (never one vague checkbox).
  await supabase.from("candidate_consents").insert([
    {
      candidate_id: cid,
      purpose: "profile_processing",
      covered_org_id: jo.responsible_org_id,
      method: "web_form",
      scope: { application_id: applicationId },
    },
    {
      candidate_id: cid,
      purpose: "share_document",
      covered_org_id: jo.responsible_org_id,
      method: "web_form",
      scope: { application_id: applicationId, cv_document_id: cvDocumentId },
    },
  ]);

  await supabase.from("application_stage_history").insert({
    application_id: applicationId,
    from_stage: null,
    to_stage: "applied_sourced",
    actor_role: "candidate",
    source: isResubmit ? "candidate_reapply" : "candidate_apply",
  });

  const { data: user } = await supabase.auth.getUser();
  if (user.user) {
    // Prefer public_jobs (safe employer label) while the role is still advertised.
    const { data: jobMeta } = await supabase
      .from("public_jobs")
      .select("title, employer_name")
      .eq("job_order_id", jobOrderId)
      .maybeSingle();
    const meta = jobMeta as { title: string; employer_name: string } | null;
    const roleLabel = meta ? `${meta.title} at ${meta.employer_name}` : "this role";
    await supabase.from("notifications").insert({
      user_id: user.user.id,
      category: "application_status",
      title: isResubmit ? "Application updated" : "Application submitted",
      body: isResubmit
        ? `Your application for ${roleLabel} was updated. We'll update you as it progresses.`
        : `Your application for ${roleLabel} was received. We'll update you as it progresses.`,
      subject_type: "application",
      subject_id: applicationId,
    });
  }

  // Fan-out to recruiters in the owning org (SECURITY DEFINER RPC — candidates
  // cannot insert notifications for other users via RLS).
  const { error: staffNotifyError } = await supabase.rpc("notify_staff_of_application", {
    p_application_id: applicationId,
    p_event: isResubmit ? "updated" : "created",
  });
  if (staffNotifyError) {
    console.error("[notify_staff_of_application]", staffNotifyError.message);
  }

  revalidatePath("/candidate/applications");
  revalidatePath("/candidate/dashboard");
  revalidatePath("/candidate/notifications");
  revalidatePath("/candidate/jobs");
  revalidatePath("/recruiter/notifications");
  revalidatePath("/recruiter/pipeline");
  return { ok: true };
}

export async function withdrawApplicationAction(applicationId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("applications")
    .update({ withdrawn_at: new Date().toISOString(), current_stage: "applied_sourced" })
    .eq("id", applicationId);
  if (error) return { ok: false, error: error.message };
  await supabase.from("application_stage_history").insert({
    application_id: applicationId,
    to_stage: "withdrawn",
    actor_role: "candidate",
    source: "candidate_withdraw",
  });
  revalidatePath("/candidate/applications");
  return { ok: true };
}
