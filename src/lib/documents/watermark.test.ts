import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  formatWatermarkLines,
  watermarkPdfBytes,
  watermarkTextAsPdf,
  type WatermarkContext,
} from "@/lib/documents/watermark";

const ctx: WatermarkContext = {
  candidateLabel: "Amina Juma (A1B2C3D4)",
  jobLabel: "Logistics Coordinator",
  employerLabel: "Serengeti Logistics",
  viewerLabel: "recruiter@example.com",
  timestampLabel: "2026-07-23 11:00:00 UTC",
};

describe("formatWatermarkLines", () => {
  it("includes candidate, job, employer, viewer, and timestamp", () => {
    const lines = formatWatermarkLines(ctx);
    expect(lines.some((l) => l.includes("Amina Juma"))).toBe(true);
    expect(lines.some((l) => l.includes("Logistics Coordinator"))).toBe(true);
    expect(lines.some((l) => l.includes("Serengeti Logistics"))).toBe(true);
    expect(lines.some((l) => l.includes("recruiter@example.com"))).toBe(true);
    expect(lines.some((l) => l.includes("2026-07-23"))).toBe(true);
  });
});

describe("watermarkPdfBytes", () => {
  it("returns a valid PDF that still has pages", async () => {
    const src = await PDFDocument.create();
    src.addPage();
    const bytes = await src.save();
    const out = await watermarkPdfBytes(bytes, ctx);
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPageCount()).toBe(1);
    expect(out.byteLength).toBeGreaterThan(bytes.byteLength);
  });
});

describe("watermarkTextAsPdf", () => {
  it("renders extract text into a stamped multi-line preview", async () => {
    const out = await watermarkTextAsPdf(
      "Experience\nBuilt logistics networks across East Africa.",
      ctx,
    );
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
