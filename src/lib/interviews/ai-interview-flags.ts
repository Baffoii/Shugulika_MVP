import "server-only";
import { createClient } from "@/lib/supabase/server";

export {
  AI_INTERVIEW_PROMPT_VERSION,
  AI_INTERVIEW_RUBRIC_VERSION,
  AI_INTERVIEW_PRIVACY_NOTICE_VERSION,
  AI_INTERVIEW_INSTRUCTIONS_VERSION,
  AI_INTERVIEW_RESERVE_USD,
} from "@/lib/interviews/ai-interview-constants";

/** True when HQ has enabled the live AI interview pilot flag. */
export async function isAiInterviewEnabled(): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("feature_flags")
    .select("is_enabled")
    .eq("key", "ai_interview_enabled")
    .maybeSingle();
  return Boolean((data as { is_enabled: boolean } | null)?.is_enabled);
}
