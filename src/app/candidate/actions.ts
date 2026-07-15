"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { candidateProfileSchema, experienceSchema, educationSchema } from "@/lib/validation";

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

async function myCandidateId(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.from("candidate_profiles").select("id").maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function updateProfileAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const values = {
    given_name: String(formData.get("given_name") ?? ""),
    family_name: String(formData.get("family_name") ?? ""),
    headline: String(formData.get("headline") ?? ""),
    summary: String(formData.get("summary") ?? ""),
    country_code: String(formData.get("country_code") ?? ""),
    city: String(formData.get("city") ?? ""),
    availability: String(formData.get("availability") ?? ""),
    open_to_work: formData.get("open_to_work") === "on",
  };
  const parsed = candidateProfileSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.issues.reduce<Record<string, string>>((a, i) => ({ ...a, [i.path.join(".")]: i.message }), {}) };
  }
  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };
  const { error } = await supabase
    .from("candidate_profiles")
    .update({
      given_name: values.given_name,
      family_name: values.family_name || null,
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
  revalidatePath("/candidate/profile");
  revalidatePath("/candidate/dashboard");
  return { ok: true };
}

export async function addExperienceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
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
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.issues.reduce<Record<string, string>>((a, i) => ({ ...a, [i.path.join(".")]: i.message }), {}) };
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

export async function addEducationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
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
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.issues.reduce<Record<string, string>>((a, i) => ({ ...a, [i.path.join(".")]: i.message }), {}) };
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

export async function addSkillAction(name: string): Promise<ActionResult> {
  const supabase = createClient();
  const cid = await myCandidateId();
  if (!cid || !name.trim()) return { ok: false, error: "Invalid" };
  const { error } = await supabase.from("candidate_skills").insert({ candidate_id: cid, name: name.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/candidate/profile");
  return { ok: true };
}

export async function deleteRowAction(table: "candidate_experiences" | "candidate_education" | "candidate_skills", id: string): Promise<ActionResult> {
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
  const { data: existing } = await supabase.from("saved_jobs").select("id").eq("candidate_id", cid).eq("job_id", jobId).maybeSingle();
  if (existing) {
    await supabase.from("saved_jobs").delete().eq("id", (existing as { id: string }).id);
  } else {
    await supabase.from("saved_jobs").insert({ candidate_id: cid, job_id: jobId });
  }
  revalidatePath("/candidate/saved-jobs");
  return { ok: true };
}

/** Apply to a job order: creates the application, a granular consent record,
 *  a stage-history row, and a candidate notification. Consent is explicit. */
export async function applyToJobAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const jobOrderId = String(formData.get("job_order_id") ?? "");
  const cvDocumentId = String(formData.get("cv_document_id") ?? "") || null;
  const consentShare = formData.get("consent_share") === "on";
  const consentProcess = formData.get("consent_process") === "on";
  const accurate = formData.get("accurate") === "on";

  if (!consentProcess || !consentShare) return { ok: false, error: "Both required consents must be given to submit." };
  if (!accurate) return { ok: false, error: "Please confirm your information is accurate." };

  const cid = await myCandidateId();
  if (!cid) return { ok: false, error: "No candidate profile" };

  const { data: joData, error: joErr } = await supabase
    .from("apply_targets")
    .select("job_order_id,responsible_org_id,recruitment_path")
    .eq("job_order_id", jobOrderId)
    .maybeSingle();
  const jo = joData as { job_order_id: string; responsible_org_id: string; recruitment_path: "A" | "B" } | null;
  if (joErr || !jo) return { ok: false, error: "This role is no longer available." };

  // Duplicate-application guard (also enforced by a unique constraint).
  const { data: dup } = await supabase.from("applications").select("id").eq("candidate_id", cid).eq("job_order_id", jobOrderId).maybeSingle();
  if (dup) return { ok: false, error: "You have already applied to this role." };

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
  if (appErr || !appData) return { ok: false, error: appErr?.message ?? "Could not submit application." };
  const applicationId = (appData as { id: string }).id;

  // Granular, timestamped consent records (never one vague checkbox).
  await supabase.from("candidate_consents").insert([
    { candidate_id: cid, purpose: "profile_processing", covered_org_id: jo.responsible_org_id, method: "web_form", scope: { application_id: applicationId } },
    { candidate_id: cid, purpose: "share_document", covered_org_id: jo.responsible_org_id, method: "web_form", scope: { application_id: applicationId, cv_document_id: cvDocumentId } },
  ]);

  await supabase.from("application_stage_history").insert({
    application_id: applicationId, from_stage: null, to_stage: "applied_sourced", actor_role: "candidate", source: "candidate_apply",
  });

  const { data: user } = await supabase.auth.getUser();
  if (user.user) {
    await supabase.from("notifications").insert({
      user_id: user.user.id, category: "application_status", title: "Application submitted",
      body: "Your application was received. We'll update you as it progresses.", subject_type: "application", subject_id: applicationId,
    });
  }

  revalidatePath("/candidate/applications");
  revalidatePath("/candidate/dashboard");
  return { ok: true };
}

export async function withdrawApplicationAction(applicationId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("applications").update({ withdrawn_at: new Date().toISOString(), current_stage: "applied_sourced" }).eq("id", applicationId);
  if (error) return { ok: false, error: error.message };
  await supabase.from("application_stage_history").insert({ application_id: applicationId, to_stage: "withdrawn", actor_role: "candidate", source: "candidate_withdraw" });
  revalidatePath("/candidate/applications");
  return { ok: true };
}
