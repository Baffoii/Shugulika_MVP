import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLES, type Portal, type Role } from "@/lib/constants";
import { rolesCanAccessPortal, homeForRoles } from "@/lib/rbac";
import type {
  ProfileRow,
  MembershipRow,
  CandidateProfileRow,
  OrganizationRow,
} from "@/lib/database.types";

export { rolesCanAccessPortal, homeForRoles };

export interface SessionContext {
  userId: string;
  email: string;
  profile: ProfileRow | null;
  memberships: MembershipRow[];
  roles: Role[];
  candidate: CandidateProfileRow | null;
}

function toRoles(memberships: MembershipRow[]): Role[] {
  const set = new Set<Role>();
  for (const m of memberships) {
    if (m.status === "active" && (ROLES as readonly string[]).includes(m.role)) {
      set.add(m.role as Role);
    }
  }
  return [...set];
}

/** Load the full session context (null when signed out). */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }, { data: candidate }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("memberships").select("*").eq("user_id", user.id),
    supabase.from("candidate_profiles").select("*").eq("user_id", user.id).maybeSingle(),
  ]);

  const ms = (memberships ?? []) as MembershipRow[];
  const profileRow = (profile as ProfileRow | null) ?? null;
  return {
    userId: user.id,
    email: user.email ?? profileRow?.email ?? "",
    profile: profileRow,
    memberships: ms,
    roles: toRoles(ms),
    candidate: (candidate as CandidateProfileRow | null) ?? null,
  };
}

/** Require any session; redirect to sign-in otherwise. */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/auth/sign-in");
  return ctx;
}

/** Require access to a portal; redirect to /unauthorized or home otherwise. */
export async function requirePortal(portal: Portal): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!rolesCanAccessPortal(ctx.roles, portal)) {
    // If the user has no roles at all, send them to onboarding.
    if (ctx.roles.length === 0) redirect("/onboarding");
    redirect("/unauthorized");
  }
  return ctx;
}

/**
 * Employer onboarding gate: usable employer access requires an ACTIVE
 * membership scoped to an ACTIVE + VERIFIED employer organization. An
 * unscoped employer_user membership (fresh sign-up) does not count.
 */
export async function getApprovedEmployerOrg(
  ctx: SessionContext,
): Promise<OrganizationRow | null> {
  const scoped = ctx.memberships.filter(
    (m) => m.status === "active" && m.role === "employer_user" && m.organization_id,
  );
  if (scoped.length === 0) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from("organizations")
    .select("*")
    .in(
      "id",
      scoped.map((m) => m.organization_id as string),
    )
    .eq("org_type", "employer")
    .eq("status", "active")
    .eq("verification_status", "verified")
    .limit(1)
    .maybeSingle();
  return (data as OrganizationRow | null) ?? null;
}

/**
 * Require an approved employer organization for the employer portal / employer
 * server actions. Redirects unapproved employers to the onboarding journey.
 */
export async function requireApprovedEmployer(): Promise<{
  ctx: SessionContext;
  employerOrg: OrganizationRow;
}> {
  const ctx = await requirePortal("employer");
  const employerOrg = await getApprovedEmployerOrg(ctx);
  if (!employerOrg) redirect("/onboarding/employer");
  return { ctx, employerOrg };
}

/** The org ids a user is a member of (used to scope org-owned reads/writes). */
export function memberOrgIds(memberships: MembershipRow[]): string[] {
  return memberships
    .filter((m) => m.status === "active" && m.organization_id)
    .map((m) => m.organization_id as string);
}

/** Primary staff org (first franchise/hq/employer membership). */
export function primaryOrgId(memberships: MembershipRow[]): string | null {
  const staff = memberships.find(
    (m) => m.status === "active" && m.organization_id && m.role !== "candidate",
  );
  return staff?.organization_id ?? null;
}
