/** Human-readable labels for persisted OpenAI purpose codes. */
export const AI_PURPOSE_LABELS: Record<string, string> = {
  cv_field_extraction: "CV field extraction",
  cv_professional_copy: "Professional summary / headline draft",
  cv_role_fit_screen: "Application role-fit screening",
};

export function purposeLabel(purpose: string): string {
  return AI_PURPOSE_LABELS[purpose] ?? purpose.replaceAll("_", " ");
}
