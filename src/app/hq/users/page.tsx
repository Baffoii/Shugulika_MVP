import { SectionStub } from "@/components/SectionStub";
export const metadata = { title: "Users & roles" };
export default function Page() {
  return (
    <SectionStub
      title="Users & roles"
      description="Create login accounts and set memberships (who can sign in as recruiter, franchise admin, HQ, etc.)."
      note="This is account provisioning — not job ownership. To put a recruiter on a specific approved role, use Jobs or Assignments."
    />
  );
}
