import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlaceholderCard, PlaceholderInline } from "@/components/PlaceholderCard";
import { PlaceholderModules } from "@/components/PlaceholderModules";
import type { PlaceholderFeature } from "@/lib/constants";

const feature: PlaceholderFeature = {
  key: "ai_video_interview",
  title: "AI video interviews",
  description: "Async video interviews with human-reviewed scoring.",
  status: "integration_pending",
  portals: ["recruiter"],
};

describe("PlaceholderCard", () => {
  it("labels the feature clearly and disables its action (no fake results)", () => {
    render(<PlaceholderCard feature={feature} />);
    expect(screen.getByText("AI video interviews")).toBeInTheDocument();
    expect(screen.getByText("Integration pending")).toBeInTheDocument();
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent(/Not available/i);
  });
});

describe("PlaceholderInline", () => {
  it("renders the label", () => {
    render(<PlaceholderInline label="AI interview — integration pending" />);
    expect(screen.getByText(/AI interview/)).toBeInTheDocument();
  });
});

describe("PlaceholderModules", () => {
  it("only renders placeholders for the requested portal", () => {
    render(<PlaceholderModules portal="hq" title="Integrations" />);
    expect(screen.getByRole("heading", { name: "Integrations", level: 1 })).toBeInTheDocument();
    // HQ-only placeholder present; a recruiter-only one is not.
    expect(screen.getByText("Whistleblowing case management")).toBeInTheDocument();
    expect(screen.queryByText("AI-generated interview questions")).not.toBeInTheDocument();
  });
});
