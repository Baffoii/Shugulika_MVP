import { SectionStub } from "@/components/SectionStub";
export const metadata = { title: "Candidates" };
export default function Page() {
  return (
    <SectionStub
      title="Candidate search"
      description="Search the authorized talent pool (candidate-approved fields only)."
      note="Candidates who opted into recruiter discovery appear here. Open any candidate from your Pipeline to view their full workspace. A dedicated search screen is planned."
    />
  );
}
