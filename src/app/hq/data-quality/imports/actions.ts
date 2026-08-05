"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePortal } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getZohoRecruitCredentialRecord } from "@/lib/integrations/zoho-recruit/store";
import {
  createImportBatch,
  recordHumanDecision,
} from "@/lib/integrations/zoho-recruit/import/store";
import { runImportStage } from "@/lib/integrations/zoho-recruit/import/pipeline";
import { liveZohoCandidateSource } from "@/lib/integrations/zoho-recruit/import/source";

const ROOT = "/hq/data-quality/imports";

async function hqActorId(): Promise<string> {
  await requirePortal("hq");
  const { data } = await createClient().auth.getUser();
  if (!data.user) redirect(`${ROOT}?import=not_signed_in`);
  return data.user.id;
}

export async function createZohoImportBatchAction(formData: FormData): Promise<void> {
  const actorId = await hqActorId();
  const connection = await getZohoRecruitCredentialRecord();
  if (!connection || connection.status !== "connected")
    redirect(`${ROOT}?import=connection_missing`);

  try {
    const batch = await createImportBatch({
      connectionId: connection.id,
      requestedBy: actorId,
      isDryRun: String(formData.get("mode") ?? "dry_run") !== "live",
    });
    revalidatePath(ROOT);
    redirect(`${ROOT}/${batch.id}?import=created`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`${ROOT}?import=create_failed`);
  }
}

export async function advanceZohoImportBatchAction(formData: FormData): Promise<void> {
  await hqActorId();
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) redirect(`${ROOT}?import=batch_missing`);
  try {
    const result = await runImportStage(batchId, liveZohoCandidateSource());
    const status = result?.blocked?.length ? "blocked" : "advanced";
    revalidatePath(`${ROOT}/${batchId}`);
    redirect(`${ROOT}/${batchId}?import=${status}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`${ROOT}/${batchId}?import=advance_failed`);
  }
}

export async function reviewZohoImportRecordAction(formData: FormData): Promise<void> {
  const actorId = await hqActorId();
  const batchId = String(formData.get("batchId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const rawDecision = String(formData.get("decision") ?? "");
  const matchedCandidateId = String(formData.get("matchedCandidateId") ?? "").trim() || null;
  if (!batchId || !recordId) redirect(`${ROOT}?import=record_missing`);
  if (rawDecision !== "create_new" && rawDecision !== "link_existing" && rawDecision !== "skip") {
    redirect(`${ROOT}/${batchId}?import=decision_invalid`);
  }

  try {
    await recordHumanDecision({
      recordId,
      decision: rawDecision,
      reviewedBy: actorId,
      matchedCandidateId,
    });
    revalidatePath(`${ROOT}/${batchId}`);
    redirect(`${ROOT}/${batchId}?import=reviewed`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(`${ROOT}/${batchId}?import=review_failed`);
  }
}
