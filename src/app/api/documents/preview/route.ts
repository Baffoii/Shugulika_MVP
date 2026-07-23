import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth";
import {
  DocumentAccessError,
  downloadOriginalBytes,
  resolvePreviewAccess,
  writeDocumentAccessEvent,
  type DocumentSourceKind,
} from "@/lib/documents/access";
import { buildWatermarkedPreview } from "@/lib/documents/preview";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_KINDS = new Set<DocumentSourceKind>(["candidate_document", "assessment_file"]);

/**
 * GET /api/documents/preview?source=candidate_document&id=...&applicationId=...&submissionId=...
 * Streams a watermarked PDF with Content-Disposition: inline (no download affordance).
 */
export async function GET(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const url = request.nextUrl;
  const source = url.searchParams.get("source") as DocumentSourceKind | null;
  const id = url.searchParams.get("id");
  if (!source || !SOURCE_KINDS.has(source) || !id) {
    return NextResponse.json({ error: "Missing source or id." }, { status: 400 });
  }

  try {
    const resolved = await resolvePreviewAccess(ctx, source, id, {
      applicationId: url.searchParams.get("applicationId"),
      submissionId: url.searchParams.get("submissionId"),
      jobOrderId: url.searchParams.get("jobOrderId"),
    });

    const supabase = createClient();
    const blob = await downloadOriginalBytes(resolved, supabase);
    const preview = await buildWatermarkedPreview(
      blob,
      resolved.mimeType,
      resolved.objectPath,
      resolved.title,
      resolved.watermark,
    );

    await writeDocumentAccessEvent(ctx, resolved, "preview");

    const filename = `${(resolved.title ?? "preview").replace(/[^\w.\-]+/g, "_")}.preview.pdf`;
    return new NextResponse(Buffer.from(preview.bytes), {
      status: 200,
      headers: {
        "Content-Type": preview.contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "X-Content-Type-Options": "nosniff",
        // Discourage casual save-as / embedding caches; not absolute DRM.
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    if (err instanceof DocumentAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[documents/preview]", err);
    return NextResponse.json({ error: "Preview failed." }, { status: 500 });
  }
}
