"use server";

import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const emailSchema = z.string().trim().email().max(254);

/**
 * Returns true when this email already belongs to an account.
 * Uses the service-role client so we can check before calling auth.signUp
 * (which would otherwise obfuscate duplicates and may re-send confirmation mail).
 */
export async function isEmailAlreadyRegistered(email: string): Promise<boolean> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return false;

  const admin = createServiceRoleClient();
  if (!admin) return false;

  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("email", parsed.data.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("isEmailAlreadyRegistered:", error.message);
    return false;
  }

  return !!data;
}
