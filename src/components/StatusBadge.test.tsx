import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, StageBadge, statusTone } from "@/components/StatusBadge";

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
