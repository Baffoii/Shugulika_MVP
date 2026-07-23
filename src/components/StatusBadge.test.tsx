import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, StageBadge, statusTone, auditActionTone } from "@/components/StatusBadge";

describe("statusTone", () => {
  it("maps known statuses to sensible tones", () => {
    expect(statusTone("rejected")).toBe("danger");
    expect(statusTone("paid")).toBe("success");
    expect(statusTone("overdue")).toBe("danger");
    expect(statusTone("consent_pending")).toBe("warn");
  });
  it("falls back to neutral for unknown values", () => {
    expect(statusTone("some_new_status")).toBe("neutral");
  });
});

describe("auditActionTone", () => {
  it("maps audit actions to worktool-style tones", () => {
    expect(auditActionTone("job_order.approved_and_published")).toBe("success");
    expect(auditActionTone("job_order.submitted")).toBe("info");
    expect(auditActionTone("job_order.recruiter_assigned")).toBe("info");
    expect(auditActionTone("job_order.withdrawn")).toBe("neutral");
    expect(auditActionTone("job_order.denied")).toBe("danger");
    expect(auditActionTone("application.stage_changed")).toBe("info");
    expect(auditActionTone("submission.created")).toBe("success");
  });
});

describe("StatusBadge", () => {
  it("renders a human label by default and does not rely on color alone", () => {
    render(<StatusBadge status="client_submission" />);
    // Text label present (not color-only) — a11y requirement.
    expect(screen.getByText("Client Submission")).toBeInTheDocument();
  });
  it("accepts an explicit label", () => {
    render(<StatusBadge status="paid" label="Paid in full" />);
    expect(screen.getByText("Paid in full")).toBeInTheDocument();
  });
});

describe("StageBadge", () => {
  it("renders the pipeline stage label", () => {
    render(<StageBadge stageKey="cv_review" />);
    expect(screen.getByText("CV Review")).toBeInTheDocument();
  });
  it("degrades gracefully for an unknown stage key", () => {
    render(<StageBadge stageKey="mystery_stage" />);
    expect(screen.getByText("Mystery Stage")).toBeInTheDocument();
  });
});
