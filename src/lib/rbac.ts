import { PORTAL_ROLES, ROLE_HOME, PUBLIC_SIGNUP_ROLES, type Portal, type Role } from "@/lib/constants";

/** Pure role/permission helpers — no server-only imports, so they are unit-testable. */

export function rolesCanAccessPortal(roles: Role[], portal: Portal): boolean {
  return roles.some((r) => PORTAL_ROLES[portal].includes(r));
}

/** Best landing route for a user based on their roles (priority order). */
export function homeForRoles(roles: Role[]): string {
  const priority: Role[] = ["hq_admin", "franchise_admin", "operations", "accounts", "recruiter", "employer_user", "candidate"];
  for (const r of priority) if (roles.includes(r)) return ROLE_HOME[r];
  return "/onboarding";
}

/** Whether a role may be chosen through public self-registration. */
export function canSelfRegisterAs(role: string): boolean {
  return (PUBLIC_SIGNUP_ROLES as string[]).includes(role);
}
