import { describe, it, expect } from "vitest";
import type { EmployerApplicationRow } from "@/lib/database.types";
import {
  ONBOARDING_STEPS,
  stepComplete,
  firstIncompleteStep,
  applicationReadyToSubmit,
  canEditApplication,
  canWithdrawApplication,
  isOpenApplicationStatus,
  parseRequestedChanges,
  reviewerActionsForStatus,
} from "./employer-onboarding";

function makeApp(overrides: Partial<EmployerApplicationRow> = {}): EmployerApplicationRow {
  return {
    id: "app-1",
    applicant_user_id: "user-1",
    status: "draft",
    version: 1,
    legal_name: "Acme Ltd",
    trading_name: null,
    organization_type: "private_company",
    industry: "Logistics",
    company_size: "11-50",
    year_established: null,
    website: null,
    country_code: "TZ",
    region: "Dar es Salaam",
    city: "Dar es Salaam",
    physical_address: "12 Harbour Road",
    postal_address: null,
    contact_name: "Jane Doe",
    contact_job_title: "MD",
    contact_email: "jane@acme.example",
    contact_phone: "+255700000000",
    contact_is_authorized: true,
    routing_mode: "auto",
    requested_franchise_id: null,
    assigned_org_id: null,
    declared_accurate: true,
    declared_authorized: true,
    accepted_terms: true,
    duplicate_warning: false,
    duplicate_reasons: [],
    changes_requested_message: null,
    requested_changes: [],
    rejection_category: null,
    rejection_reason: null,
    reapply_allowed: null,
    previous_application_id: null,
    resulting_org_id: null,
    submitted_at: null,
    first_submitted_at: null,
    decided_at: null,
    decided_by: null,
    created_at: "2026-07-24T00:00:00Z",
    updated_at: "2026-07-24T00:00:00Z",
    ...overrides,
  };
}

describe("onboarding wizard steps", () => {
  it("a fully filled application is ready to submit", () => {
    const app = makeApp();
    for (const step of ONBOARDING_STEPS) expect(stepComplete(app, step.key)).toBe(true);
    expect(firstIncompleteStep(app)).toBeNull();
    expect(applicationReadyToSubmit(app)).toBe(true);
  });

  it("missing / blank required fields mark the owning step incomplete", () => {
    expect(stepComplete(makeApp({ legal_name: "  " }), "company")).toBe(false);
    expect(firstIncompleteStep(makeApp({ legal_name: null }))).toBe("company");
    expect(firstIncompleteStep(makeApp({ city: "" }))).toBe("address");
    expect(firstIncompleteStep(makeApp({ contact_is_authorized: false }))).toBe("contact");
    expect(firstIncompleteStep(makeApp({ accepted_terms: false }))).toBe("declarations");
  });

  it("routing is complete for auto/hq, but franchise mode requires a choice", () => {
    expect(stepComplete(makeApp({ routing_mode: "auto" }), "routing")).toBe(true);
    expect(stepComplete(makeApp({ routing_mode: "hq" }), "routing")).toBe(true);
    expect(
      stepComplete(makeApp({ routing_mode: "franchise", requested_franchise_id: null }), "routing"),
    ).toBe(false);
    expect(
      stepComplete(
        makeApp({ routing_mode: "franchise", requested_franchise_id: "org-1" }),
        "routing",
      ),
    ).toBe(true);
  });
});

describe("status machine", () => {
  it("editing is only allowed in draft / changes_requested", () => {
    expect(canEditApplication("draft")).toBe(true);
    expect(canEditApplication("changes_requested")).toBe(true);
    for (const s of ["submitted", "under_review", "approved", "rejected", "withdrawn"]) {
      expect(canEditApplication(s)).toBe(false);
    }
  });

  it("withdrawal is only allowed before review starts", () => {
    expect(canWithdrawApplication("draft")).toBe(true);
    expect(canWithdrawApplication("submitted")).toBe(true);
    expect(canWithdrawApplication("under_review")).toBe(false);
    expect(canWithdrawApplication("approved")).toBe(false);
  });

  it("open statuses block a second application; closed ones do not", () => {
    for (const s of ["draft", "submitted", "under_review", "changes_requested"]) {
      expect(isOpenApplicationStatus(s)).toBe(true);
    }
    for (const s of ["approved", "rejected", "withdrawn"]) {
      expect(isOpenApplicationStatus(s)).toBe(false);
    }
  });

  it("reviewer decisions only apply to submitted / under_review", () => {
    expect(reviewerActionsForStatus("submitted")).toEqual({
      canOpenReview: true,
      canDecide: true,
    });
    expect(reviewerActionsForStatus("under_review")).toEqual({
      canOpenReview: false,
      canDecide: true,
    });
    expect(reviewerActionsForStatus("approved").canDecide).toBe(false);
    expect(reviewerActionsForStatus("draft").canDecide).toBe(false);
  });
});

describe("parseRequestedChanges", () => {
  it("normalizes well-formed items and drops junk", () => {
    expect(
      parseRequestedChanges([
        { field: "legal_name", instruction: "Match the certificate spelling." },
        { instruction: "Add a reachable phone number." },
        { instruction: "   " },
        { field: "website" },
        "nonsense",
        null,
      ]),
    ).toEqual([
      { field: "legal_name", instruction: "Match the certificate spelling." },
      { field: undefined, instruction: "Add a reachable phone number." },
    ]);
    expect(parseRequestedChanges(null)).toEqual([]);
    expect(parseRequestedChanges({})).toEqual([]);
  });
});
