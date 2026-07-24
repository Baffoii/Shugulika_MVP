"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession, getApprovedEmployerOrg, type SessionContext } from "@/lib/auth";
import {
  employerCompanySectionSchema,
  employerAddressSectionSchema,
  employerContactSectionSchema,
  employerRoutingSectionSchema,
  employerDeclarationsSectionSchema,
  fieldErrors,
} from "@/lib/validation";
import {
  ONBOARDING_STEPS,
  canEditApplication,
  type OnboardingStepKey,
} from "@/lib/employer-onboarding";
import type { EmployerApplicationRow } from "@/lib/database.types";

export interface OnboardingActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
}

const ONBOARDING_PATH = "/onboarding/employer";

async function requireEmployerApplicant(): Promise<SessionContext> {
  const ctx = await requireSession();
  const isEmployer = ctx.memberships.some(
    (m) => m.status === "active" && m.role === "employer_user",
  );
  if (!isEmployer) redirect("/unauthorized");
  if (await getApprovedEmployerOrg(ctx)) redirect("/employer/dashboard");
  return ctx;
}

async function loadMyApplication(userId: string): Promise<EmployerApplicationRow | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("employer_applications")
    .select("*")
    .eq("applicant_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as EmployerApplicationRow | null) ?? null;
}

function optional(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function nextStepAfter(step: OnboardingStepKey): string {
  const idx = ONBOARDING_STEPS.findIndex((s) => s.key === step);
  const next = ONBOARDING_STEPS[idx + 1];
  return next ? next.key : "review";
}

/** Save one wizard section (autosave-per-section), then advance the journey. */
export async function saveEmployerOnboardingSectionAction(
  _previous: OnboardingActionResult,
  formData: FormData,
): Promise<OnboardingActionResult> {
  const ctx = await requireEmployerApplicant();
  const step = String(formData.get("step") ?? "") as OnboardingStepKey;
  if (!ONBOARDING_STEPS.some((s) => s.key === step)) {
    return { ok: false, error: "Unknown form section." };
  }

  let payload: Record<string, unknown>;
  if (step === "company") {
    const parsed = employerCompanySectionSchema.safeParse({
      legal_name: optional(formData, "legal_name"),
      trading_name: optional(formData, "trading_name"),
      organization_type: optional(formData, "organization_type"),
      industry: optional(formData, "industry"),
      company_size: optional(formData, "company_size"),
      year_established: optional(formData, "year_established"),
      website: optional(formData, "website"),
    });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    payload = {
      ...parsed.data,
      trading_name: parsed.data.trading_name || null,
      year_established:
        parsed.data.year_established === "" || parsed.data.year_established == null
          ? null
          : parsed.data.year_established,
      website: parsed.data.website || null,
    };
  } else if (step === "address") {
    const parsed = employerAddressSectionSchema.safeParse({
      country_code: optional(formData, "country_code"),
      region: optional(formData, "region"),
      city: optional(formData, "city"),
      physical_address: optional(formData, "physical_address"),
      postal_address: optional(formData, "postal_address"),
    });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    payload = { ...parsed.data, postal_address: parsed.data.postal_address || null };
  } else if (step === "contact") {
    const parsed = employerContactSectionSchema.safeParse({
      contact_name: optional(formData, "contact_name"),
      contact_job_title: optional(formData, "contact_job_title"),
      contact_email: optional(formData, "contact_email"),
      contact_phone: optional(formData, "contact_phone"),
      contact_is_authorized: formData.get("contact_is_authorized") === "on",
    });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    payload = parsed.data;
  } else if (step === "routing") {
    const parsed = employerRoutingSectionSchema.safeParse({
      routing_mode: optional(formData, "routing_mode") || "auto",
      requested_franchise_id: optional(formData, "requested_franchise_id"),
    });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    payload = {
      routing_mode: parsed.data.routing_mode,
      requested_franchise_id:
        parsed.data.routing_mode === "franchise" ? parsed.data.requested_franchise_id : null,
    };
  } else {
    const parsed = employerDeclarationsSectionSchema.safeParse({
      declared_accurate: formData.get("declared_accurate") === "on",
      declared_authorized: formData.get("declared_authorized") === "on",
      accepted_terms: formData.get("accepted_terms") === "on",
    });
    if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
    payload = parsed.data;
  }

  const supabase = createClient();
  const existing = await loadMyApplication(ctx.userId);

  if (existing) {
    if (!canEditApplication(existing.status)) {
      return { ok: false, error: "This application is read-only while it is being reviewed." };
    }
    const { error } = await supabase
      .from("employer_applications")
      .update(payload)
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    // First save creates the draft; prefill the primary contact from the
    // signing-up user's profile so later sections start populated.
    const { error } = await supabase.from("employer_applications").insert({
      applicant_user_id: ctx.userId,
      status: "draft",
      contact_name: ctx.profile?.full_name ?? null,
      contact_email: ctx.email || null,
      contact_phone: ctx.profile?.phone ?? null,
      ...payload,
    });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(ONBOARDING_PATH);
  redirect(`${ONBOARDING_PATH}?step=${nextStepAfter(step)}`);
}

/** Final submission from the review screen (server re-validates everything). */
export async function submitEmployerApplicationAction(
  _previous: OnboardingActionResult,
  formData: FormData,
): Promise<OnboardingActionResult> {
  const ctx = await requireEmployerApplicant();
  const applicationId = String(formData.get("application_id") ?? "");
  const app = await loadMyApplication(ctx.userId);
  if (!app || app.id !== applicationId) {
    return { ok: false, error: "Application not found." };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("submit_employer_application", {
    p_application_id: applicationId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(ONBOARDING_PATH);
  revalidatePath("/hq/employer-applications");
  revalidatePath("/franchise/employer-applications");
  redirect(ONBOARDING_PATH);
}

/** Withdraw a draft or submitted application (allowed before review starts). */
export async function withdrawEmployerApplicationAction(
  applicationId: string,
): Promise<OnboardingActionResult> {
  await requireEmployerApplicant();
  const supabase = createClient();
  const { error } = await supabase.rpc("withdraw_employer_application", {
    p_application_id: applicationId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(ONBOARDING_PATH);
  revalidatePath("/hq/employer-applications");
  revalidatePath("/franchise/employer-applications");
  return { ok: true, message: "Application withdrawn." };
}

/** Start a revised application after a rejection (when allowed) or withdrawal. */
export async function startRevisedEmployerApplicationAction(
  previousApplicationId: string,
): Promise<OnboardingActionResult> {
  await requireEmployerApplicant();
  const supabase = createClient();
  const { error } = await supabase.rpc("start_revised_employer_application", {
    p_previous_id: previousApplicationId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(ONBOARDING_PATH);
  redirect(ONBOARDING_PATH);
}
