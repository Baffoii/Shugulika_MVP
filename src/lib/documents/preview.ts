import "server-only";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import {
  unsupportedPreviewPdf,
  watermarkImageBytes,
  watermarkPdfBytes,
  watermarkTextAsPdf,
  type WatermarkContext,
} from "@/lib/documents/watermark";

function extensionOf(objectPath: string): string {
  const base = objectPath.split(/[\\/]/).pop() ?? objectPath;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

function mimeFromExtension(ext: string): string | null {
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "doc") return "application/msword";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === "txt") return "text/plain";
  if (ext === "rtf") return "application/rtf";
  return null;
}

function isGenericDownloadMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    !m ||
    m.includes("octet-stream") ||
    m.includes("x-download") ||
    /(^|\/|;|\s)download([;+]|$)/.test(m)
  );
}

/**
 * Prefer a real type from the filename when the provider sends a useless
 * or conflicting download MIME (Zoho often returns x-download or msword for .docx).
 */
function mimeOf(mimeType: string | null, objectPath: string): string {
  const fromExt = mimeFromExtension(extensionOf(objectPath));
  const raw = (mimeType ?? "").toLowerCase();
  if (fromExt && isGenericDownloadMime(raw)) return fromExt;
  // Zoho sometimes labels .docx as application/msword — trust the extension.
  if (fromExt?.includes("wordprocessingml") && raw.includes("msword")) return fromExt;
  if (raw) return raw;
  return fromExt ?? "application/octet-stream";
}

function sniffKind(buffer: Uint8Array): "pdf" | "docx" | "doc" | "png" | "jpeg" | null {
  if (buffer.length < 5) return null;
  // %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "pdf";
  }
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "png";
  }
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  // ZIP → DOCX
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return "docx";
  }
  // OLE Compound File → legacy .doc
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
    return "doc";
  }
  return null;
}

async function toBytes(input: Blob | Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(await input.arrayBuffer());
}

/** Extract plain text from .docx (mammoth) or legacy .doc (word-extractor). */
async function extractWordText(buffer: Uint8Array): Promise<string | null> {
  const nodeBuffer = Buffer.from(buffer);

  try {
    const result = await mammoth.extractRawText({ buffer: nodeBuffer });
    const text = result.value?.trim();
    if (text) return text;
  } catch {
    // Fall through to legacy .doc extractor.
  }

  try {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(nodeBuffer);
    const text = [doc.getBody(), doc.getHeaders(), doc.getFooters()]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text) return text;
  } catch {
    // Fall through.
  }

  return null;
}

/**
 * Produce a watermarked PDF preview from an original file blob.
 * PDFs and images are stamped; Word docs are text-extracted into a stamped PDF;
 * other types get a stamped notice page.
 */
export async function buildWatermarkedPreview(
  blob: Blob | Uint8Array | ArrayBuffer,
  mimeType: string | null,
  objectPath: string,
  title: string | null,
  ctx: WatermarkContext,
): Promise<{ bytes: Uint8Array; contentType: "application/pdf" }> {
  let mime = mimeOf(mimeType, objectPath);
  const buffer = await toBytes(blob);
  const sniffed = sniffKind(buffer);

  // Recover when MIME/filename are wrong but bytes are recognizable.
  if (sniffed === "pdf") mime = "application/pdf";
  if (sniffed === "png") mime = "image/png";
  if (sniffed === "jpeg") mime = "image/jpeg";
  if (sniffed === "docx") {
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (sniffed === "doc") mime = "application/msword";

  if (mime.includes("pdf") || sniffed === "pdf") {
    return { bytes: await watermarkPdfBytes(buffer, ctx), contentType: "application/pdf" };
  }

  if (
    mime.includes("png") ||
    mime.includes("jpeg") ||
    mime.includes("jpg") ||
    sniffed === "png" ||
    sniffed === "jpeg"
  ) {
    return {
      bytes: await watermarkImageBytes(buffer, mime, ctx),
      contentType: "application/pdf",
    };
  }

  const looksLikeWord =
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    /\.docx?$/i.test(objectPath) ||
    sniffed === "docx" ||
    sniffed === "doc";

  if (looksLikeWord) {
    const text = await extractWordText(buffer);
    if (text) {
      return {
        bytes: await watermarkTextAsPdf(text, ctx, title ?? "Document preview"),
        contentType: "application/pdf",
      };
    }
    return {
      bytes: await unsupportedPreviewPdf(mime, ctx),
      contentType: "application/pdf",
    };
  }

  if (mime.includes("text/plain") || mime.includes("rtf") || /\.(txt|rtf)$/i.test(objectPath)) {
    const text = Buffer.from(buffer).toString("utf8").trim() || "(Empty document.)";
    return {
      bytes: await watermarkTextAsPdf(text, ctx, title ?? "Document preview"),
      contentType: "application/pdf",
    };
  }

  return {
    bytes: await unsupportedPreviewPdf(mime, ctx),
    contentType: "application/pdf",
  };
}
