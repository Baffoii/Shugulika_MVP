import {
  PORTAL_ROLES,
  ROLE_HOME,
  PUBLIC_SIGNUP_ROLES,
  type Portal,
  type Role,
} from "@/lib/constants";
import type { MembershipRow } from "@/lib/database.types";

/** Pure role/permission helpers — no server-only imports, so they are unit-testable. */

export type RecruiterLevel = "generic" | "head" | "junior";

export function rolesCanAccessPortal(roles: Role[], portal: Portal): boolean {
  return roles.some((r) => PORTAL_ROLES[portal].includes(r));
}

/** Best landing route for a user based on their roles (priority order). */
export function homeForRoles(roles: Role[]): string {
  const priority: Role[] = [
    "hq_admin",
    "franchise_admin",
    "operations",
    "accounts",
    "recruiter",
    "employer_user",
    "candidate",
  ];
  for (const r of priority) if (roles.includes(r)) return ROLE_HOME[r];
  return "/onboarding";
}

/** Whether a role may be chosen through public self-registration. */
export function canSelfRegisterAs(role: string): boolean {
  return (PUBLIC_SIGNUP_ROLES as string[]).includes(role);
}

/** HQ / franchise / operations may assign recruiter job roles. */
export function canAssignRecruiterRoles(roles: Role[]): boolean {
  return roles.some((r) => r === "hq_admin" || r === "franchise_admin" || r === "operations");
}

export function isHqAdmin(roles: Role[]): boolean {
  return roles.includes("hq_admin");
}

/**
 * Region codes the admin may assign roles within.
 * HQ returns null (= unrestricted). Franchise/ops return their membership
 * country codes (falling back to empty = no assignable region).
 */
export function assignableRegionCodes(
  roles: Role[],
  memberships: MembershipRow[],
): string[] | null {
  if (isHqAdmin(roles)) return null;
  if (!canAssignRecruiterRoles(roles)) return [];
  const codes = new Set<string>();
  for (const m of memberships) {
    if (
      m.status === "active" &&
      (m.role === "franchise_admin" || m.role === "operations") &&
      m.country_code
    ) {
      codes.add(m.country_code);
    }
  }
  return [...codes];
}

/** Whether an admin may assign a role in the given region. */
export function canAssignInRegion(
  roles: Role[],
  memberships: MembershipRow[],
  regionCode: string,
): boolean {
  const allowed = assignableRegionCodes(roles, memberships);
  if (allowed === null) return true;
  return allowed.includes(regionCode);
}

/** Resolve recruiter KPI level from memberships (defaults to generic). */
export function recruiterLevelFromMemberships(memberships: MembershipRow[]): RecruiterLevel {
  const rec = memberships.find((m) => m.status === "active" && m.role === "recruiter");
  const level = rec?.recruiter_level;
  if (level === "head" || level === "junior" || level === "generic") return level;
  return "generic";
}
