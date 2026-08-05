/** Human-readable labels for persisted OpenAI purpose codes. */
export const AI_PURPOSE_LABELS: Record<string, string> = {
  cv_field_extraction: "CV field extraction",
  cv_professional_copy: "Professional summary / headline draft",
  cv_role_fit_screen: "Application role-fit screening",
  assessment_free_response: "Aptitude free-response grading",
  assessment_ai_authenticity: "Aptitude AI-writing authenticity check",
  interview_plan_generation: "AI voice interview plan drafting",
  interview_live_realtime: "AI voice live Realtime session",
  interview_transcription: "AI voice interview transcription",
  interview_evidence_review: "AI voice interview evidence review",
};

export function purposeLabel(purpose: string): string {
  return AI_PURPOSE_LABELS[purpose] ?? purpose.replaceAll("_", " ");
}
