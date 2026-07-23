/**
 * Persist OpenAI token usage for the HQ AI credits dashboard.
 * Failures are swallowed — metering must never break CV parse / screening.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { estimateUsd, type AiFeature, type TokenUsage, aiWarn } from "@/lib/ai-cost-log";
import type { AiUsageFeature } from "@/lib/database.types";

const PERSISTABLE_FEATURES = new Set<AiFeature>(["resume", "screening", "assessment"]);

export async function recordAiUsageEvent(opts: {
  feature: AiFeature;
  purpose: string;
  model: string;
  durationMs: number;
  usage?: TokenUsage | null;
}): Promise<void> {
  if (!PERSISTABLE_FEATURES.has(opts.feature)) return;
  const feature = opts.feature as AiUsageFeature;

  try {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const actorId = userData.user?.id ?? null;
    const usd = estimateUsd(opts.usage ?? null);
    const { error } = await supabase.from("ai_usage_events").insert({
      feature,
      purpose: opts.purpose,
      model: opts.model,
      prompt_tokens: opts.usage?.prompt_tokens ?? null,
      completion_tokens: opts.usage?.completion_tokens ?? null,
      total_tokens: opts.usage?.total_tokens ?? null,
      estimated_usd: usd,
      duration_ms: opts.durationMs,
      actor_id: actorId,
    });
    if (error) {
      aiWarn("openai", "USAGE_PERSIST_FAILED", {
        purpose: opts.purpose,
        message: error.message,
        tip: "Apply migration 20260722093000_ai_usage_events.sql if the table is missing",
      });
    }
  } catch (error) {
    aiWarn("openai", "USAGE_PERSIST_FAILED", {
      purpose: opts.purpose,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
