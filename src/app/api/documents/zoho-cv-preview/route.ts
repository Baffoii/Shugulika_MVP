import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth";
import {
  downloadCandidateResumeAttachment,
  isSupportedResumeContentType,
  resolveCandidateResumeAttachment,
} from "@/lib/integrations/zoho-recruit/candidate-attachments";
import { buildWatermarkedPreview } from "@/lib/documents/preview";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/documents/zoho-cv-preview?searchRowId=…&jobOrderId=…
 * Downloads a Zoho candidate attachment server-side, watermarks it, streams inline PDF.
 * Never exposes Zoho URLs, tokens, or raw unwatermarked bytes.
 */
export async function GET(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!ctx.roles.includes("employer_user")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const searchRowId = request.nextUrl.searchParams.get("searchRowId")?.trim() ?? "";
  const jobOrderId = request.nextUrl.searchParams.get("jobOrderId")?.trim() ?? "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      searchRowId,
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobOrderId)
  ) {
    return NextResponse.json({ error: "Missing searchRowId or jobOrderId." }, { status: 400 });
  }

  const supabase = createClient();
  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json({ error: "Preview unavailable." }, { status: 503 });
  }

  const { data: orgId, error: orgError } = await supabase.rpc("employer_org_for_caller");
  if (orgError || !orgId) {
    return NextResponse.json({ error: "No approved employer organization." }, { status: 403 });
  }

  const { data: ownsJob } = await supabase.rpc("employer_owns_path_a_job", {
    p_employer_org: orgId as string,
    p_job_order: jobOrderId,
  });
  if (!ownsJob) {
    return NextResponse.json(
      { error: "Select one of your Direct (Path A) jobs." },
      { status: 403 },
    );
  }

  const { data: searchRow, error: rowError } = await service
    .from("zoho_recruit_candidate_search")
    .select(
      "id, zoho_candidate_id, teaser_label, full_name, job_title, has_resume, zoho_attachment_id, is_active, search_eligible",
    )
    .eq("id", searchRowId)
    .maybeSingle();

  if (rowError || !searchRow) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  const row = searchRow as {
    id: string;
    zoho_candidate_id: string;
    teaser_label: string;
    full_name: string | null;
    job_title: string | null;
    has_resume: boolean;
    zoho_attachment_id: string | null;
    is_active: boolean;
    search_eligible: boolean;
  };

  if (!row.is_active || !row.search_eligible) {
    return NextResponse.json({ error: "Candidate is no longer available." }, { status: 404 });
  }

  const { data: unlock } = await service
    .from("employer_zoho_candidate_unlocks")
    .select("id")
    .eq("employer_org_id", orgId as string)
    .eq("zoho_candidate_id", row.zoho_candidate_id)
    .maybeSingle();

  if (!unlock) {
    return NextResponse.json(
      { error: "Unlock this candidate before previewing the CV." },
      { status: 403 },
    );
  }

  try {
    let attachmentId = row.zoho_attachment_id;
    let fileName: string | null = null;

    if (!attachmentId) {
      const resolved = await resolveCandidateResumeAttachment(row.zoho_candidate_id);
      if (!resolved.attachment) {
        return NextResponse.json({ error: "No resume attachment found." }, { status: 404 });
      }
      attachmentId = resolved.attachment.id;
      fileName = resolved.attachment.fileName;
      await service
        .from("zoho_recruit_candidate_search")
        .update({
          has_resume: true,
          zoho_attachment_id: attachmentId,
        } as never)
        .eq("id", row.id);
    }

    const downloaded = await downloadCandidateResumeAttachment(row.zoho_candidate_id, attachmentId);
    if (!isSupportedResumeContentType(downloaded.contentType, fileName)) {
      return NextResponse.json({ error: "Unsupported resume file type." }, { status: 415 });
    }

    const { data: job } = await supabase
      .from("job_orders")
      .select("title")
      .eq("id", jobOrderId)
      .maybeSingle();

    const viewerLabel = ctx.profile?.full_name?.trim() || ctx.email || ctx.userId;
    const candidateLabel =
      row.full_name?.trim() || row.teaser_label || `Candidate ${row.zoho_candidate_id.slice(-8)}`;
    const preview = await buildWatermarkedPreview(
      new Blob([Buffer.from(downloaded.bytes)], {
        type: downloaded.contentType ?? "application/octet-stream",
      }),
      downloaded.contentType,
      fileName ?? "resume",
      row.job_title ?? "Resume",
      {
        candidateLabel,
        jobLabel: (job as { title?: string } | null)?.title?.trim() || "Direct role",
        employerLabel: employerOrgNameFallback(ctx),
        viewerLabel,
        timestampLabel: new Date()
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d{3}Z$/, " UTC"),
      },
    );

    await service.from("audit_logs").insert({
      actor_id: ctx.userId,
      action: "document.zoho_cv_preview",
      entity_type: "zoho_recruit_candidate_search",
      entity_id: row.id,
      metadata: {
        job_order_id: jobOrderId,
        org_context_id: orgId,
        watermarked: true,
        provider: "zoho_recruit",
      },
    } as never);

    return new NextResponse(Buffer.from(preview.bytes), {
      status: 200,
      headers: {
        "Content-Type": preview.contentType,
        "Content-Disposition": 'inline; filename="resume.preview.pdf"',
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error(
      "[documents/zoho-cv-preview]",
      error instanceof Error ? error.message : "preview_failed",
    );
    return NextResponse.json({ error: "Preview failed." }, { status: 500 });
  }
}

function employerOrgNameFallback(ctx: { profile?: { full_name?: string | null } | null }): string {
  return ctx.profile?.full_name?.trim() || "Employer";
}
