import "server-only";
import mammoth from "mammoth";
import {
  unsupportedPreviewPdf,
  watermarkImageBytes,
  watermarkPdfBytes,
  watermarkTextAsPdf,
  type WatermarkContext,
} from "@/lib/documents/watermark";

function mimeOf(mimeType: string | null, objectPath: string): string {
  if (mimeType) return mimeType.toLowerCase();
  const ext = objectPath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "doc") return "application/msword";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

/**
 * Produce a watermarked PDF preview from an original file blob.
 * PDFs and images are stamped; DOCX is text-extracted into a stamped PDF;
 * other types get a stamped notice page.
 */
export async function buildWatermarkedPreview(
  blob: Blob,
  mimeType: string | null,
  objectPath: string,
  title: string | null,
  ctx: WatermarkContext,
): Promise<{ bytes: Uint8Array; contentType: "application/pdf" }> {
  const mime = mimeOf(mimeType, objectPath);
  const buffer = new Uint8Array(await blob.arrayBuffer());

  if (mime.includes("pdf")) {
    return { bytes: await watermarkPdfBytes(buffer, ctx), contentType: "application/pdf" };
  }

  if (mime.includes("png") || mime.includes("jpeg") || mime.includes("jpg")) {
    return {
      bytes: await watermarkImageBytes(buffer, mime, ctx),
      contentType: "application/pdf",
    };
  }

  if (
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    objectPath.endsWith(".docx")
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      const text = result.value?.trim() || "(No extractable text in this document.)";
      return {
        bytes: await watermarkTextAsPdf(text, ctx, title ?? "Document preview"),
        contentType: "application/pdf",
      };
    } catch {
      return {
        bytes: await unsupportedPreviewPdf(mime, ctx),
        contentType: "application/pdf",
      };
    }
  }

  return {
    bytes: await unsupportedPreviewPdf(mime, ctx),
    contentType: "application/pdf",
  };
}
