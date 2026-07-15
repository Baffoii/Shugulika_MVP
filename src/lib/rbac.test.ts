import { describe, it, expect } from "vitest";
import { rolesCanAccessPortal, homeForRoles, canSelfRegisterAs } from "@/lib/rbac";
import { PRIVILEGED_ROLES, PUBLIC_SIGNUP_ROLES } from "@/lib/constants";

describe("portal access", () => {
  it("candidate can access only the candidate portal", () => {
    expect(rolesCanAccessPortal(["candidate"], "candidate")).toBe(true);
    expect(rolesCanAccessPortal(["candidate"], "recruiter")).toBe(false);
    expect(rolesCanAccessPortal(["candidate"], "hq")).toBe(false);
  });

  it("employer_user can access only the employer portal", () => {
    expect(rolesCanAccessPortal(["employer_user"], "employer")).toBe(true);
    expect(rolesCanAccessPortal(["employer_user"], "recruiter")).toBe(false);
  });

  it("hq_admin can reach hq, franchise, and recruiter portals", () => {
    expect(rolesCanAccessPortal(["hq_admin"], "hq")).toBe(true);
    expect(rolesCanAccessPortal(["hq_admin"], "franchise")).toBe(true);
    expect(rolesCanAccessPortal(["hq_admin"], "recruiter")).toBe(true);
  });

  it("no roles cannot access any portal", () => {
    expect(rolesCanAccessPortal([], "candidate")).toBe(false);
  });
});

describe("home routing", () => {
  it("prioritizes the most privileged role", () => {
    expect(homeForRoles(["candidate", "hq_admin"])).toBe("/hq/dashboard");
    expect(homeForRoles(["candidate"])).toBe("/candidate/dashboard");
    expect(homeForRoles(["recruiter"])).toBe("/recruiter/dashboard");
  });
  it("falls back to onboarding with no roles", () => {
    expect(homeForRoles([])).toBe("/onboarding");
  });
});

describe("public self-registration is restricted", () => {
  it("allows only candidate and employer_user", () => {
    expect(canSelfRegisterAs("candidate")).toBe(true);
    expect(canSelfRegisterAs("employer_user")).toBe(true);
  });
  it("rejects every privileged role", () => {
    for (const role of PRIVILEGED_ROLES) {
      expect(canSelfRegisterAs(role)).toBe(false);
    }
  });
  it("privileged and public roles are disjoint", () => {
    for (const r of PUBLIC_SIGNUP_ROLES) expect(PRIVILEGED_ROLES).not.toContain(r);
  });
});
