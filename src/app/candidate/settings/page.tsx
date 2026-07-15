import type { Metadata } from "next";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Alert } from "@/components/ui/primitives";
import { PlaceholderInline } from "@/components/PlaceholderCard";
import { createClient } from "@/lib/supabase/server";
import { getMyCandidate } from "@/lib/data/candidate";
import { getSessionContext } from "@/lib/auth";
import { VisibilityForm } from "./VisibilityForm";
import type { CandidateVisibilityRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Settings" };

export default async function CandidateSettingsPage() {
  const [candidate, session] = await Promise.all([getMyCandidate(), getSessionContext()]);
  if (!candidate || !session) return null;
  const supabase = createClient();
  const { data: vis } = await supabase.from("candidate_search_visibility").select("*").eq("candidate_id", candidate.id).maybeSingle();
  const v = vis as CandidateVisibilityRow | null;

  return (
    <div>
      <PageHeader title="Settings" description="Control your discoverability and account preferences." />
      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>Profile visibility</CardTitle></CardHeader>
          <CardBody>
            <VisibilityForm candidateId={candidate.id} initialSearchable={v?.is_searchable ?? false} initialFields={v?.approved_fields ?? []} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p><span className="text-ink-subtle">Email:</span> <span className="font-medium text-ink">{session.email}</span></p>
            <p className="flex items-center gap-2">
              <span className="text-ink-subtle">Phone verification:</span> <PlaceholderInline label="SMS OTP integration pending — email verification used" />
            </p>
            <form action="/auth/sign-out" method="post" className="pt-2">
              <button className="rounded-lg border border-surface-border px-3 py-1.5 text-sm text-status-danger hover:bg-red-50">Sign out</button>
            </form>
          </CardBody>
        </Card>

        <Alert tone="info" title="Your data">
          You can build one reusable profile and control what is shared. A full data-export and account-deletion flow is planned; contact support to request either in the MVP.
        </Alert>
      </div>
    </div>
  );
}
