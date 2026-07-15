import type { Metadata } from "next";
import { PlaceholderModules } from "@/components/PlaceholderModules";

export const metadata: Metadata = { title: "Integrations" };

export default function HqIntegrationsPage() {
  return (
    <PlaceholderModules
      portal="hq"
      title="Integrations"
      description="External services the platform will connect to. Each has a reserved place and a database-ready status, but none are live in this MVP."
    />
  );
}
