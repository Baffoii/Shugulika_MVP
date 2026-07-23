import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentPreviewButton } from "@/components/documents/DocumentPreviewButton";
import { DocumentExportButton } from "@/components/documents/DocumentExportButton";

describe("DocumentPreviewButton", () => {
  it("renders a preview action without a download label", () => {
    render(
      <DocumentPreviewButton
        source="candidate_document"
        id="00000000-0000-0000-0000-000000000001"
        label="Preview CV"
      />,
    );
    expect(screen.getByRole("button", { name: /Preview CV/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
  });
});

describe("DocumentExportButton", () => {
  it("labels Super Admin export as audited", () => {
    render(
      <DocumentExportButton
        source="candidate_document"
        id="00000000-0000-0000-0000-000000000001"
      />,
    );
    expect(screen.getByRole("button", { name: /Export original/i })).toBeInTheDocument();
    expect(screen.getByText(/Super Admin only/i)).toBeInTheDocument();
  });
});
