import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobFilters } from "@/components/jobs/JobFilters";
import { routerMock } from "@/test/setup";

describe("JobFilters", () => {
  beforeEach(() => {
    routerMock.push.mockClear();
  });

  it("renders labelled, accessible controls", () => {
    render(<JobFilters />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByLabelText("Keyword")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("pushes the keyword into the URL on submit, respecting the base path", () => {
    render(<JobFilters basePath="/candidate/jobs" />);
    fireEvent.change(screen.getByLabelText("Keyword"), { target: { value: "analyst" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(routerMock.push).toHaveBeenCalledTimes(1);
    expect(routerMock.push).toHaveBeenCalledWith(expect.stringContaining("/candidate/jobs?"));
    expect(routerMock.push).toHaveBeenCalledWith(expect.stringContaining("q=analyst"));
  });

  it("applies a filter change immediately", () => {
    render(<JobFilters />);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "full_time" } });
    expect(routerMock.push).toHaveBeenCalledWith(
      expect.stringContaining("employment_type=full_time"),
    );
  });
});
