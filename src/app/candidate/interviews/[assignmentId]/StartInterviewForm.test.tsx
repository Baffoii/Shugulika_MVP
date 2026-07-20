import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routerMock } from "@/test/setup";
import { StartInterviewForm } from "./StartInterviewForm";

const startInterviewAction = vi.fn();
vi.mock("@/app/candidate/interview-actions", () => ({
  startInterviewAction: (...args: unknown[]) => startInterviewAction(...args),
}));

describe("StartInterviewForm consent", () => {
  beforeEach(() => {
    startInterviewAction.mockReset();
    startInterviewAction.mockResolvedValue({ ok: true });
    routerMock.push.mockClear();
  });

  it("blocks a new interview until explicit recording consent", async () => {
    render(<StartInterviewForm assignmentId="assignment-1" alreadyStarted={false} />);
    const start = screen.getByRole("button", { name: "Start device check" });
    const consent = screen.getByRole("checkbox", { name: /consent to recording/i });

    expect(start).toBeDisabled();
    fireEvent.click(consent);
    expect(start).toBeEnabled();
    fireEvent.click(start);

    await waitFor(() => {
      expect(startInterviewAction).toHaveBeenCalledWith("assignment-1", true);
      expect(routerMock.push).toHaveBeenCalledWith("/candidate/interviews/assignment-1/session");
    });
  });

  it("shows a start failure and does not navigate", async () => {
    startInterviewAction.mockResolvedValue({ ok: false, error: "Interview expired." });
    render(<StartInterviewForm assignmentId="assignment-2" alreadyStarted={false} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /consent to recording/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start device check" }));

    expect(await screen.findByText("Interview expired.")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("continues an active interview without asking for consent again", async () => {
    render(<StartInterviewForm assignmentId="assignment-3" alreadyStarted />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue interview" }));

    await waitFor(() => {
      expect(startInterviewAction).not.toHaveBeenCalled();
      expect(routerMock.push).toHaveBeenCalledWith("/candidate/interviews/assignment-3/session");
    });
  });
});
