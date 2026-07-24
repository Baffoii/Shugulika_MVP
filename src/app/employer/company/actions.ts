"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedEmployer } from "@/lib/auth";
import { fieldErrors } from "@/lib/validation";
import type { OrganizationRow } from "@/lib/database.types";

export interface CompanyUpdateResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
}

/**
 * Ordinary company details the first employer administrator may edit directly.
 * Registered legal name, country, and responsible franchise are intentionally
 * absent — those changes require Shugulika review (also enforced by a database
 * trigger, not just this action).
 */
const ordinaryDetailsSchema = z.object({
  trading_name: z.string().max(200).optional().or(z.literal("")),
  website: z
    .string()
    .url("Enter a valid website URL (https://…)")
    .max(300)
    .optional()
    .or(z.literal("")),
  industry: z.string().max(120).optional().or(z.literal("")),
  company_size: z.string().max(40).optional().or(z.literal("")),
  region: z.string().max(120).optional().or(z.literal("")),
  city: z.string().max(120).optional().or(z.literal("")),
  physical_address: z.string().max(400).optional().or(z.literal("")),
  postal_address: z.string().max(400).optional().or(z.literal("")),
});

export async function updateEmployerCompanyAction(
  _previous: CompanyUpdateResult,
  formData: FormData,
): Promise<CompanyUpdateResult> {
  const { ctx, employerOrg } = await requireApprovedEmployer();
  const admin = ctx.memberships.some(
    (m) =>
      m.status === "active" &&
      m.role === "employer_user" &&
      m.organization_id === employerOrg.id &&
      m.is_org_admin,
  );
  if (!admin) {
    return { ok: false, error: "Only the company administrator can edit company details." };
  }

  const parsed = ordinaryDetailsSchema.safeParse({
    trading_name: String(formData.get("trading_name") ?? "").trim(),
    website: String(formData.get("website") ?? "").trim(),
    industry: String(formData.get("industry") ?? "").trim(),
    company_size: String(formData.get("company_size") ?? "").trim(),
    region: String(formData.get("region") ?? "").trim(),
    city: String(formData.get("city") ?? "").trim(),
    physical_address: String(formData.get("physical_address") ?? "").trim(),
    postal_address: String(formData.get("postal_address") ?? "").trim(),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  const values = Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [key, value || null]),
  );

  const supabase = createClient();
  const { error } = await supabase
    .from("organizations")
    .update(values as Partial<OrganizationRow>)
    .eq("id", employerOrg.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/employer/company");
  return { ok: true, message: "Company details updated." };
}
