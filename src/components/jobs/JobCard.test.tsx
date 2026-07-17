import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobCard } from "@/components/jobs/JobCard";
import { makePublicJob } from "@/test/fixtures";

describe("JobCard", () => {
  it("shows the role, employer, and a route-tagged link", () => {
    const job = makePublicJob({
      title: "Logistics Coordinator",
      employer_name: "Serengeti Logistics",
    });
    render(<JobCard job={job} />);
    expect(screen.getByRole("heading", { name: "Logistics Coordinator" })).toBeInTheDocument();
    expect(screen.getByText("Serengeti Logistics")).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/jobs/${job.public_slug}`);
  });

  it("respects a custom detail base path (candidate portal)", () => {
    const job = makePublicJob();
    render(<JobCard job={job} detailBasePath="/candidate/jobs" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", `/candidate/jobs/${job.public_slug}`);
  });

  it("labels the recruitment route", () => {
    render(<JobCard job={makePublicJob({ recruitment_path: "A" })} />);
    expect(screen.getByText(/Direct employer/i)).toBeInTheDocument();
  });

  it("shows a salary range when disclosed", () => {
    render(
      <JobCard
        job={makePublicJob({ salary_min: 1000, salary_max: 2000, salary_currency: "TZS" })}
      />,
    );
    expect(screen.getByText(/–/)).toBeInTheDocument();
  });

  it("shows an Applied badge when the candidate already applied", () => {
    render(<JobCard job={makePublicJob()} applied />);
    expect(screen.getByText(/^Applied$/i)).toBeInTheDocument();
  });
});
