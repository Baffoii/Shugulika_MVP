/**
 * Build and apply per-viewer watermarks for document previews (R-021).
 * Output is always PDF (viewable inline) with a large light-blue Shugulika
 * logo wordmark stamp plus an audit footer.
 */
import {
  PDFDocument,
  rgb,
  StandardFonts,
  degrees,
  PageSizes,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

export type WatermarkContext = {
  candidateLabel: string;
  jobLabel: string;
  employerLabel: string;
  viewerLabel: string;
  timestampLabel: string;
};

/** Classic translucent watermark blue (#73AEE6 family). */
const WATERMARK_BLUE = rgb(0.45, 0.68, 0.9);
const WATERMARK_BLUE_DEEP = rgb(0.32, 0.55, 0.82);

export function formatWatermarkLines(ctx: WatermarkContext): string[] {
  return [
    `Candidate: ${ctx.candidateLabel}`,
    `Job: ${ctx.jobLabel}`,
    `Employer: ${ctx.employerLabel}`,
    `Viewer: ${ctx.viewerLabel}`,
    `Accessed: ${ctx.timestampLabel}`,
    "Shugulika · view-only · do not redistribute",
  ];
}

export function watermarkPlainText(ctx: WatermarkContext): string {
  return formatWatermarkLines(ctx).join(" · ");
}

/**
 * Draw the Shugulika brand mark: wordmark + tie glyph between "shugul" and "ka".
 * Drawn in the page's local space then rotated as a single stamp.
 */
function drawShugulikaLogo(
  page: PDFPage,
  font: PDFFont,
  originX: number,
  originY: number,
  scale: number,
  opacity: number,
) {
  const size = 38 * scale;
  const gap = 4 * scale;
  const shugulWidth = font.widthOfTextAtSize("shugul", size);
  const tieWidth = 14 * scale;

  // Build unrotated layout at (0,0), then place+rotate via draw ops that accept rotate.
  // pdf-lib rotates each draw around its own origin — so we place pieces along a
  // diagonal baseline by offsetting x/y with the rotation angle.
  const angle = 32;
  const rad = (angle * Math.PI) / 180;
  const along = (dx: number) => ({
    x: originX + dx * Math.cos(rad),
    y: originY + dx * Math.sin(rad),
  });

  const p0 = along(0);
  page.drawText("shugul", {
    x: p0.x,
    y: p0.y,
    size,
    font,
    color: WATERMARK_BLUE,
    opacity,
    rotate: degrees(angle),
  });

  const tieAt = along(shugulWidth + gap);
  // Tie knot
  page.drawEllipse({
    x: tieAt.x + 5.5 * scale * Math.cos(rad),
    y: tieAt.y + 5.5 * scale * Math.sin(rad),
    xScale: 5 * scale,
    yScale: 4.5 * scale,
    color: WATERMARK_BLUE,
    opacity,
    rotate: degrees(angle),
  });
  // Tie body
  page.drawSvgPath("M 0 8 H 11 L 15.5 52 L 5.5 58 L -4.5 52 Z", {
    x: tieAt.x,
    y: tieAt.y,
    scale,
    color: WATERMARK_BLUE,
    opacity,
    rotate: degrees(angle),
  });

  const kaAt = along(shugulWidth + gap + tieWidth + gap);
  page.drawText("ka", {
    x: kaAt.x,
    y: kaAt.y,
    size,
    font,
    color: WATERMARK_BLUE,
    opacity,
    rotate: degrees(angle),
  });
}

async function stampPages(pdf: PDFDocument, lines: string[]): Promise<Uint8Array> {
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const footer = lines.join("  |  ");
  const meta = lines.slice(0, 4).join("  ·  ");

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    // Large logo: ~70–80% of page width relative to the 300-unit brand canvas.
    const scale = Math.max(1.6, Math.min(2.8, (width * 0.78) / 300));

    const stamps: Array<{ x: number; y: number; scale: number; opacity: number }> = [
      { x: width * 0.02, y: height * 0.14, scale: scale * 0.92, opacity: 0.14 },
      { x: width * 0.06, y: height * 0.4, scale: scale, opacity: 0.26 },
      { x: width * 0.1, y: height * 0.68, scale: scale * 0.92, opacity: 0.14 },
    ];

    for (const s of stamps) {
      drawShugulikaLogo(page, fontBold, s.x, s.y, s.scale, s.opacity);
    }

    page.drawText(meta, {
      x: width * 0.06,
      y: height * 0.28,
      size: Math.max(12, Math.min(18, width / 40)),
      font,
      color: WATERMARK_BLUE_DEEP,
      opacity: 0.3,
      rotate: degrees(32),
      maxWidth: width * 0.95,
      lineHeight: 16,
    });

    page.drawText(footer, {
      x: 24,
      y: 18,
      size: 8,
      font,
      color: WATERMARK_BLUE_DEEP,
      opacity: 0.8,
      maxWidth: width - 48,
    });
  }

  return pdf.save({ useObjectStreams: false });
}

async function noticePdf(title: string, body: string, lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(PageSizes.A4);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();
  page.drawText(title, { x: 48, y: height - 72, size: 16, font: bold, color: rgb(0.1, 0.1, 0.1) });
  const wrapped = wrapText(body, 90);
  let y = height - 110;
  for (const line of wrapped) {
    page.drawText(line, { x: 48, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
    y -= 16;
  }
  return stampPages(pdf, lines);
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Watermark an existing PDF. */
export async function watermarkPdfBytes(
  bytes: Uint8Array,
  ctx: WatermarkContext,
): Promise<Uint8Array> {
  const lines = formatWatermarkLines(ctx);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return stampPages(pdf, lines);
}

/** Embed a JPEG/PNG into a single-page PDF and watermark it. */
export async function watermarkImageBytes(
  bytes: Uint8Array,
  mimeType: string,
  ctx: WatermarkContext,
): Promise<Uint8Array> {
  const lines = formatWatermarkLines(ctx);
  const pdf = await PDFDocument.create();
  const isPng = mimeType.includes("png");
  const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return stampPages(pdf, lines);
}

/** Render plain text (e.g. DOCX extract) as a watermarked multi-page PDF. */
export async function watermarkTextAsPdf(
  text: string,
  ctx: WatermarkContext,
  title = "Document preview",
): Promise<Uint8Array> {
  const lines = formatWatermarkLines(ctx);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = PageSizes.A4[0];
  const pageHeight = PageSizes.A4[1];
  const margin = 48;
  const maxChars = 95;
  const contentLines = text
    .split(/\r?\n/)
    .flatMap((line) => (line.trim().length === 0 ? [""] : wrapText(line, maxChars)));

  let page = pdf.addPage(PageSizes.A4);
  let y = pageHeight - margin;
  page.drawText(title, { x: margin, y, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 28;

  for (const line of contentLines.slice(0, 2000)) {
    if (y < margin + 40) {
      page = pdf.addPage(PageSizes.A4);
      y = pageHeight - margin;
    }
    page.drawText(line.slice(0, 120), {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.15, 0.15, 0.15),
      maxWidth: pageWidth - margin * 2,
    });
    y -= 14;
  }

  return stampPages(pdf, lines);
}

export async function unsupportedPreviewPdf(
  mimeType: string | null,
  ctx: WatermarkContext,
): Promise<Uint8Array> {
  return noticePdf(
    "Preview unavailable for this file type",
    `This file (${mimeType ?? "unknown type"}) cannot be rendered as a watermarked preview. Ask the uploader to provide a PDF or image. Original download is restricted to Super Admin export.`,
    formatWatermarkLines(ctx),
  );
}
