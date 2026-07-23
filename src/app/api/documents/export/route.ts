import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth";
import {
  DocumentAccessError,
  downloadOriginalBytes,
  resolveExportAccess,
  writeDocumentAccessEvent,
  type DocumentSourceKind,
} from "@/lib/documents/access";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_KINDS = new Set<DocumentSourceKind>(["candidate_document", "assessment_file"]);

/**
 * GET /api/documents/export?source=...&id=...
 * Super Admin (hq_admin) only — audited original-file export.
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
    const resolved = await resolveExportAccess(ctx, source, id);
    const supabase = createClient();
    const blob = await downloadOriginalBytes(resolved, supabase);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    await writeDocumentAccessEvent(ctx, resolved, "export", { export: true });

    const rawName = resolved.title ?? resolved.objectPath.split("/").pop() ?? "export.bin";
    const filename = rawName.replace(/[^\w.\-]+/g, "_");
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": resolved.mimeType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof DocumentAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[documents/export]", err);
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}
