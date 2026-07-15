import type { Metadata } from "next";
import { PlaceholderModules } from "@/components/PlaceholderModules";

export const metadata: Metadata = { title: "Assessments" };

export default function CandidateAssessmentsPage() {
  return (
    <PlaceholderModules
      portal="candidate"
      title="Assessments"
      description="Skills and psychometric assessments you're invited to complete will appear here."
      only={["assessments", "ai_video_interview"]}
    />
  );
}
