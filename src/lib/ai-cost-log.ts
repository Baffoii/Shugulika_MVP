/**
 * Verbose, PII-safe logging for OpenAI-backed CV features.
 * Never log CV body, prompts, API keys, or raw provider payloads.
 *
 * Approximate gpt-4.1-mini standard rates (USD / 1M tokens) for MVP budget
 * tracking against a small prepaid credit balance — not billing-grade.
 */
import "server-only";

import { recordAiUsageEvent } from "@/lib/ai-usage-record";

const TAG = {
  screening: "[ai:screening]",
  resume: "[ai:resume-parse]",
  assessment: "[ai:assessment]",
  openai: "[ai:openai]",
} as const;

export type AiFeature = keyof typeof TAG;

/** Rough gpt-4.1-mini standard API rates — update if you change models. */
const RATE_USD_PER_1M = {
  input: 0.4,
  output: 1.6,
} as const;

export interface TokenUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export function estimateUsd(usage: TokenUsage | null | undefined): number | null {
  if (!usage) return null;
  const inTok = usage.prompt_tokens ?? 0;
  const outTok = usage.completion_tokens ?? 0;
  if (!inTok && !outTok) return null;
  return (
    (inTok / 1_000_000) * RATE_USD_PER_1M.input + (outTok / 1_000_000) * RATE_USD_PER_1M.output
  );
}

export function formatUsd(usd: number | null | undefined): string {
  if (usd == null || Number.isNaN(usd)) return "n/a";
  if (usd < 0.0001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

/** ~4 chars/token heuristic for pre-call size estimates (not billed usage). */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

function stamp(): string {
  return new Date().toISOString();
}

export function aiLog(feature: AiFeature, step: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`${TAG[feature]} ${step}`, { t: stamp(), ...data });
  } else {
    console.log(`${TAG[feature]} ${step}`, { t: stamp() });
  }
}

export function aiWarn(feature: AiFeature, step: string, data?: Record<string, unknown>): void {
  if (data) {
    console.warn(`${TAG[feature]} ${step}`, { t: stamp(), ...data });
  } else {
    console.warn(`${TAG[feature]} ${step}`, { t: stamp() });
  }
}

export function aiError(
  feature: AiFeature,
  step: string,
  error?: unknown,
  data?: Record<string, unknown>,
): void {
  const err =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : error != null
        ? { message: String(error) }
        : undefined;
  console.error(`${TAG[feature]} ${step}`, { t: stamp(), ...data, err });
}

/** Log a completed OpenAI call with token usage + rough USD, and persist for HQ. */
export async function aiLogOpenAiCall(opts: {
  feature: AiFeature;
  purpose: string;
  model: string;
  durationMs: number;
  usage?: TokenUsage | null;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const usd = estimateUsd(opts.usage ?? null);
  aiLog("openai", "CALL_COMPLETE", {
    feature: opts.feature,
    purpose: opts.purpose,
    model: opts.model,
    durationMs: opts.durationMs,
    promptTokens: opts.usage?.prompt_tokens ?? null,
    completionTokens: opts.usage?.completion_tokens ?? null,
    totalTokens: opts.usage?.total_tokens ?? null,
    estimatedUsd: formatUsd(usd),
    estimatedUsdRaw: usd,
    note: "estimatedUsd uses gpt-4.1-mini list rates — check OpenAI dashboard for actual",
    ...opts.extra,
  });
  if (usd != null && usd > 0.05) {
    aiWarn("openai", "CALL_RELATIVELY_EXPENSIVE", {
      purpose: opts.purpose,
      estimatedUsd: formatUsd(usd),
      tip: "Re-screen / re-parse burns credits — prefer cache hits for demos",
    });
  }
  await recordAiUsageEvent(opts);
}
