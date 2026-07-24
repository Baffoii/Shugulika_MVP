/**
 * Employer onboarding (Workflow 1) — pure helpers shared by the registration
 * wizard, status screens, and review queues. No server-only imports so
 * everything here is unit-testable.
 */
import type { EmployerApplicationRow } from "@/lib/database.types";
import {
  EMPLOYER_APPLICATION_STATUS_LABELS,
  type EmployerApplicationStatus,
} from "@/lib/constants";

export type OnboardingStepKey = "company" | "address" | "contact" | "routing" | "declarations";

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  description: string;
  /** Application columns that must be present before the step counts as done. */
  requiredFields: (keyof EmployerApplicationRow)[];
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "company",
    label: "Company identity",
    description: "Who the company is — no tax ID or registration number needed.",
    requiredFields: ["legal_name", "organization_type", "industry", "company_size"],
  },
  {
    key: "address",
    label: "Registered address",
    description: "Where the company is registered and operates.",
    requiredFields: ["country_code", "region", "city", "physical_address"],
  },
  {
    key: "contact",
    label: "Primary contact",
    description: "The person who will administer the employer account.",
    requiredFields: [
      "contact_name",
      "contact_job_title",
      "contact_email",
      "contact_phone",
      "contact_is_authorized",
    ],
  },
  {
    key: "routing",
    label: "Shugulika office",
    description: "The Shugulika office responsible for your company.",
    requiredFields: [],
  },
  {
    key: "declarations",
    label: "Declarations",
    description: "Accuracy, authorization, and terms.",
    requiredFields: ["declared_accurate", "declared_authorized", "accepted_terms"],
  },
];

function fieldPresent(app: EmployerApplicationRow, field: keyof EmployerApplicationRow): boolean {
  const value = app[field];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().length > 0;
  return value != null;
}

export function stepComplete(app: EmployerApplicationRow, key: OnboardingStepKey): boolean {
  const step = ONBOARDING_STEPS.find((s) => s.key === key);
  if (!step) return false;
  if (key === "routing") {
    // Routing needs an explicit choice only when the user asked for a
    // specific franchise; auto and hq resolve at submission time.
    return app.routing_mode !== "franchise" || !!app.requested_franchise_id;
  }
  return step.requiredFields.every((f) => fieldPresent(app, f));
}

/** First step with missing data (used to resume the wizard). */
export function firstIncompleteStep(app: EmployerApplicationRow): OnboardingStepKey | null {
  for (const step of ONBOARDING_STEPS) {
    if (!stepComplete(app, step.key)) return step.key;
  }
  return null;
}

/** All required information present — the review screen may enable Submit. */
export function applicationReadyToSubmit(app: EmployerApplicationRow): boolean {
  return firstIncompleteStep(app) === null;
}

/** The applicant may edit fields only while draft / changes requested. */
export function canEditApplication(status: string): boolean {
  return status === "draft" || status === "changes_requested";
}

/** Withdrawal is allowed before review starts. */
export function canWithdrawApplication(status: string): boolean {
  return status === "draft" || status === "submitted";
}

/** Open = still moving through the workflow (blocks a second application). */
export function isOpenApplicationStatus(status: string): boolean {
  return ["draft", "submitted", "under_review", "changes_requested"].includes(status);
}

export function applicationStatusLabel(status: string): string {
  return (
    EMPLOYER_APPLICATION_STATUS_LABELS[status as EmployerApplicationStatus] ??
    status.replace(/_/g, " ")
  );
}

/** Employer-facing explanation of the current state (status screen headline). */
export function applicationStatusDescription(app: EmployerApplicationRow): string {
  switch (app.status) {
    case "draft":
      return "Complete each section, then review and submit your company registration.";
    case "submitted":
      return "Your application is waiting for review by the responsible Shugulika office. You can withdraw it until review starts.";
    case "under_review":
      return "A reviewer is looking at your application. We will notify you as soon as there is a decision.";
    case "changes_requested":
      return "The reviewer asked for changes. Update the highlighted information and resubmit.";
    case "approved":
      return "Your company is approved and the employer portal is unlocked.";
    case "rejected":
      return app.reapply_allowed
        ? "Your application was not approved. You may submit a revised application."
        : "Your application was not approved. Contact support if you believe this is a mistake.";
    case "withdrawn":
      return "You withdrew this application. You can start a new one at any time.";
    default:
      return "";
  }
}

/** Reviewer decisions available for the current status. */
export function reviewerActionsForStatus(status: string): {
  canOpenReview: boolean;
  canDecide: boolean;
} {
  return {
    canOpenReview: status === "submitted",
    canDecide: status === "submitted" || status === "under_review",
  };
}

/** Human labels for application timeline events. */
export const APPLICATION_EVENT_LABELS: Record<string, string> = {
  submitted: "Submitted for review",
  resubmitted: "Resubmitted after changes",
  review_opened: "Review started",
  changes_requested: "Changes requested",
  approved: "Approved — company activated",
  rejected: "Not approved",
  reassigned: "Responsible office updated",
  withdrawn: "Withdrawn",
  revision_started: "Revised application started",
  note: "Internal note",
};

export interface RequestedChangeItem {
  field?: string;
  instruction: string;
}

/** Normalize the requested_changes jsonb into a typed list. */
export function parseRequestedChanges(value: unknown): RequestedChangeItem[] {
  if (!Array.isArray(value)) return [];
  const out: RequestedChangeItem[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && "instruction" in item) {
      const instruction = String((item as { instruction: unknown }).instruction ?? "").trim();
      if (!instruction) continue;
      const field = (item as { field?: unknown }).field;
      out.push({ instruction, field: typeof field === "string" && field ? field : undefined });
    }
  }
  return out;
}
