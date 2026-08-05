import "server-only";
import OpenAI from "openai";
import { serverEnv } from "@/lib/env.server";
import { aiError, aiLog, aiLogOpenAiCall } from "@/lib/ai-cost-log";
import { createClient } from "@/lib/supabase/server";
import type { InterviewLiveSessionRow } from "@/lib/database.types";

export class InterviewTranscribeError extends Error {}

/**
 * Transcribe the private candidate audio track after a live session.
 * Returns plain text (speaker already known: candidate only).
 */
export async function transcribeLiveSessionAudio(
  session: InterviewLiveSessionRow,
): Promise<{ text: string; durationMs: number }> {
  if (!session.candidate_audio_bucket || !session.candidate_audio_path) {
    throw new InterviewTranscribeError("No candidate audio was uploaded for this session.");
  }

  const supabase = createClient();
  const { data: blob, error } = await supabase.storage
    .from(session.candidate_audio_bucket)
    .download(session.candidate_audio_path);
  if (error || !blob) {
    throw new InterviewTranscribeError(error?.message ?? "Could not download candidate audio.");
  }

  const model = serverEnv.openaiTranscribeModel();
  const client = new OpenAI({ apiKey: serverEnv.openaiApiKey() });
  const started = Date.now();
  try {
    aiLog("openai", "CALL_START", { purpose: "interview_transcription", model });
    const file = new File(
      [blob],
      session.candidate_audio_path.split("/").pop() ?? "candidate-audio.webm",
      { type: session.candidate_audio_mime ?? (blob.type || "audio/webm") },
    );
    const result = await client.audio.transcriptions.create({
      file,
      model,
      response_format: "json",
    });
    const durationMs = Date.now() - started;
    aiLogOpenAiCall({
      feature: "interview",
      purpose: "interview_transcription",
      model,
      durationMs,
      usage: null,
    });
    const text = (result as { text?: string }).text?.trim() ?? "";
    if (!text) throw new InterviewTranscribeError("Transcription returned empty text.");
    return { text, durationMs };
  } catch (error) {
    if (error instanceof InterviewTranscribeError) throw error;
    aiError("interview", "OPENAI_CALL_FAILED", error, { purpose: "interview_transcription" });
    throw new InterviewTranscribeError("Transcription failed.");
  }
}
