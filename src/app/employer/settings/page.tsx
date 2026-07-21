import { SectionStub } from "@/components/SectionStub";
export const metadata = { title: "Settings" };
export default function Page() {
  return (
    <SectionStub
      title="Settings"
      description="Company users and notification preferences for your employer client account."
      note="Employer roles are Company Admin and Hiring Team Member. Team management is scaffolded — MVP accounts are single-user employer_user logins per company."
    />
  );
}
