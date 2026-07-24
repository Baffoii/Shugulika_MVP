import { describe, it, expect } from "vitest";
import {
  rolesCanAccessPortal,
  homeForRoles,
  canSelfRegisterAs,
  canAssignRecruiterRoles,
  isHqAdmin,
  assignableRegionCodes,
  canAssignInRegion,
  recruiterLevelFromMemberships,
} from "@/lib/rbac";
import { PRIVILEGED_ROLES, PUBLIC_SIGNUP_ROLES } from "@/lib/constants";
import type { MembershipRow } from "@/lib/database.types";

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

describe("recruiter role assignment permissions", () => {
  const franchiseMem: MembershipRow = {
    id: "1",
    user_id: "u1",
    organization_id: "org1",
    role: "franchise_admin",
    country_code: "TZ",
    recruiter_level: null,
    status: "active",
    is_org_admin: false,
    created_at: "",
  };
  const opsMem: MembershipRow = { ...franchiseMem, role: "operations", country_code: "KE" };

  it("hq can assign any region", () => {
    expect(canAssignRecruiterRoles(["hq_admin"])).toBe(true);
    expect(isHqAdmin(["hq_admin"])).toBe(true);
    expect(assignableRegionCodes(["hq_admin"], [])).toBeNull();
    expect(canAssignInRegion(["hq_admin"], [], "TZ")).toBe(true);
    expect(canAssignInRegion(["hq_admin"], [], "KE")).toBe(true);
  });

  it("franchise admin is locked to membership country", () => {
    expect(canAssignRecruiterRoles(["franchise_admin"])).toBe(true);
    expect(assignableRegionCodes(["franchise_admin"], [franchiseMem])).toEqual(["TZ"]);
    expect(canAssignInRegion(["franchise_admin"], [franchiseMem], "TZ")).toBe(true);
    expect(canAssignInRegion(["franchise_admin"], [franchiseMem], "KE")).toBe(false);
  });

  it("operations is locked to membership country", () => {
    expect(assignableRegionCodes(["operations"], [opsMem])).toEqual(["KE"]);
    expect(canAssignInRegion(["operations"], [opsMem], "KE")).toBe(true);
    expect(canAssignInRegion(["operations"], [opsMem], "TZ")).toBe(false);
  });

  it("recruiters cannot assign roles", () => {
    expect(canAssignRecruiterRoles(["recruiter"])).toBe(false);
    expect(assignableRegionCodes(["recruiter"], [])).toEqual([]);
  });

  it("resolves recruiter level from memberships", () => {
    expect(
      recruiterLevelFromMemberships([
        {
          ...franchiseMem,
          role: "recruiter",
          recruiter_level: "head",
        },
      ]),
    ).toBe("head");
    expect(recruiterLevelFromMemberships([])).toBe("generic");
  });
});
