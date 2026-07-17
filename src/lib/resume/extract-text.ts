import "server-only";

/**
 * Server-only raw text extraction for uploaded CVs. Node runtime required
 * (pdf-parse/mammoth are not Edge-compatible) — Server Actions default to
 * Node, so no `export const runtime = "edge"` must ever be added near these
 * call sites.
 */
export class UnsupportedResumeFileError extends Error {}

export async function extractResumeText(buffer: Buffer, fileName: string): Promise<string> {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }

  if (extension === "docx" || extension === "doc") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  throw new UnsupportedResumeFileError(`Unsupported file type: .${extension}`);
}
