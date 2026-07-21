"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  canAssignInRegion,
  canAssignRecruiterRoles,
  assignableRegionCodes,
} from "@/lib/rbac";
import {
  assignRoleToRecruiter,
  revokeRoleFromRecruiter,
  getRecruiterProfile,
} from "@/lib/data/recruiter-kpis";

export interface RoleActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export async function assignRecruiterRoleAction(formData: FormData): Promise<RoleActionResult> {
  const ctx = await requireSession();
  if (!canAssignRecruiterRoles(ctx.roles)) {
    return { ok: false, error: "You do not have permission to assign roles." };
  }

  const recruiterId = String(formData.get("recruiterId") ?? "");
  const jobRoleId = String(formData.get("jobRoleId") ?? "");
  const regionCode = String(formData.get("regionCode") ?? "");

  if (!recruiterId || !jobRoleId || !regionCode) {
    return { ok: false, error: "Recruiter, role, and region are required." };
  }

  if (!canAssignInRegion(ctx.roles, ctx.memberships, regionCode)) {
    return { ok: false, error: `You cannot assign roles in region ${regionCode}.` };
  }

  const profile = await getRecruiterProfile(recruiterId);
  if (!profile) return { ok: false, error: "Recruiter not found." };

  const result = await assignRoleToRecruiter({
    recruiterId,
    jobRoleId,
    assignedBy: ctx.userId,
    regionCode,
    organizationId: profile.organizationId,
  });

  if (!result.ok) return result;

  revalidatePath(`/hq/recruiters/${recruiterId}`);
  revalidatePath(`/franchise/recruiters/${recruiterId}`);
  revalidatePath("/hq/recruiters");
  revalidatePath("/franchise/recruiters");
  revalidatePath("/recruiter/kpis");

  return {
    ok: true,
    message: `Successfully assigned ${jobRoleId} to ${profile.name}`,
  };
}

export async function revokeRecruiterRoleAction(formData: FormData): Promise<RoleActionResult> {
  const ctx = await requireSession();
  if (!canAssignRecruiterRoles(ctx.roles)) {
    return { ok: false, error: "You do not have permission to revoke roles." };
  }

  const recruiterId = String(formData.get("recruiterId") ?? "");
  const jobRoleId = String(formData.get("jobRoleId") ?? "");
  const regionCode = String(formData.get("regionCode") ?? "");

  if (!recruiterId || !jobRoleId) {
    return { ok: false, error: "Recruiter and role are required." };
  }

  // Region-locked admins: only revoke within their region
  const allowed = assignableRegionCodes(ctx.roles, ctx.memberships);
  if (allowed !== null) {
    if (!regionCode || !allowed.includes(regionCode)) {
      return { ok: false, error: "You cannot revoke roles outside your region." };
    }
  }

  const result = await revokeRoleFromRecruiter({
    recruiterId,
    jobRoleId,
    revokedBy: ctx.userId,
  });

  if (!result.ok) return result;

  revalidatePath(`/hq/recruiters/${recruiterId}`);
  revalidatePath(`/franchise/recruiters/${recruiterId}`);
  revalidatePath("/hq/recruiters");
  revalidatePath("/franchise/recruiters");
  revalidatePath("/recruiter/kpis");

  return { ok: true, message: "Role revoked." };
}
