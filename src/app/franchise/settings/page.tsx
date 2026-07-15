import { SectionStub } from "@/components/SectionStub";
export const metadata = { title: "Settings" };
export default function Page() {
  return (
    <SectionStub
      title="Team & permissions"
      description="Manage your franchise team and access."
      note="Includes a “View as this role” preview in a later iteration. Privileged roles are provisioned here by the franchise admin."
    />
  );
}
