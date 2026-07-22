import { createClient } from "@/lib/supabase/server";
import { formatUsd } from "@/lib/ai-cost-log";
import { purposeLabel } from "@/lib/ai-purpose-labels";
import type { AiUsageEventRow } from "@/lib/database.types";

export { purposeLabel, AI_PURPOSE_LABELS } from "@/lib/ai-purpose-labels";

export interface AiUsagePurposeBreakdown {
  purpose: string;
  label: string;
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedUsd: number;
}

export interface AiUsageSummary {
  /** Token-level events from ai_usage_events (post-migration). */
  events: AiUsageEventRow[];
  byPurpose: AiUsagePurposeBreakdown[];
  totals: {
    callCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedUsd: number;
  };
  /** Activity counts from existing run tables (includes pre-ledger history). */
  activity: {
    openaiResumeParses: number;
    succeededScreens: number;
    failedScreens: number;
  };
  prepaidBalanceUsd: number | null;
  estimatedRemainingUsd: number | null;
  openaiUsageUrl: string;
  openaiBillingUrl: string;
}

function sumBreakdown(events: AiUsageEventRow[]): AiUsagePurposeBreakdown[] {
  const map = new Map<string, AiUsagePurposeBreakdown>();
  for (const e of events) {
    const existing = map.get(e.purpose) ?? {
      purpose: e.purpose,
      label: purposeLabel(e.purpose),
      callCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedUsd: 0,
    };
    existing.callCount += 1;
    existing.promptTokens += e.prompt_tokens ?? 0;
    existing.completionTokens += e.completion_tokens ?? 0;
    existing.totalTokens += e.total_tokens ?? 0;
    existing.estimatedUsd += Number(e.estimated_usd ?? 0);
    map.set(e.purpose, existing);
  }
  return [...map.values()].sort((a, b) => b.estimatedUsd - a.estimatedUsd);
}

/**
 * HQ-only AI spend overview. Relies on RLS (`auth_is_hq`) for ai_usage_events
 * and staff-visible run tables.
 */
export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  const supabase = createClient();
  const prepaidRaw = process.env.OPENAI_PREPAID_BALANCE_USD;
  const prepaidBalanceUsd =
    prepaidRaw && !Number.isNaN(Number(prepaidRaw)) ? Number(prepaidRaw) : null;

  const [eventsRes, resumeRes, screensRes] = await Promise.all([
    supabase
      .from("ai_usage_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("resume_parse_runs")
      .select("id", { count: "exact", head: true })
      .eq("provider", "openai")
      .eq("status", "succeeded"),
    supabase.from("application_ai_reviews").select("status"),
  ]);

  // Table may not exist until the migration is applied — treat as empty.
  const events =
    eventsRes.error && /ai_usage_events|schema cache|does not exist/i.test(eventsRes.error.message)
      ? []
      : ((eventsRes.data as AiUsageEventRow[] | null) ?? []);

  const byPurpose = sumBreakdown(events);
  const totals = byPurpose.reduce(
    (acc, row) => ({
      callCount: acc.callCount + row.callCount,
      promptTokens: acc.promptTokens + row.promptTokens,
      completionTokens: acc.completionTokens + row.completionTokens,
      totalTokens: acc.totalTokens + row.totalTokens,
      estimatedUsd: acc.estimatedUsd + row.estimatedUsd,
    }),
    { callCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedUsd: 0 },
  );

  const screenRows = (screensRes.data as { status: string }[] | null) ?? [];
  const activity = {
    openaiResumeParses: resumeRes.count ?? 0,
    succeededScreens: screenRows.filter((r) => r.status === "succeeded").length,
    failedScreens: screenRows.filter((r) => r.status === "failed").length,
  };

  const estimatedRemainingUsd =
    prepaidBalanceUsd != null ? Math.max(0, prepaidBalanceUsd - totals.estimatedUsd) : null;

  return {
    events,
    byPurpose,
    totals,
    activity,
    prepaidBalanceUsd,
    estimatedRemainingUsd,
    openaiUsageUrl: "https://platform.openai.com/usage",
    openaiBillingUrl: "https://platform.openai.com/settings/organization/billing/overview",
  };
}

/** Re-export helpers used by the page for formatting. */
export { formatUsd };
