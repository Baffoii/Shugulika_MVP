import type { Metadata } from "next";
import { PageHeader, Alert } from "@/components/ui/primitives";
import { getMyCandidate, getMyDocuments } from "@/lib/data/candidate";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DocumentManager } from "./DocumentManager";

export const metadata: Metadata = { title: "Documents" };

export default async function CandidateDocumentsPage() {
  const [candidate, session] = await Promise.all([getMyCandidate(), getSessionContext()]);
  if (!candidate || !session)
    return <Alert tone="warn">Profile still setting up. Refresh in a moment.</Alert>;
  const documents = await getMyDocuments(candidate.id);
  const supabase = createClient();
  const { data: locked } = await supabase.rpc("candidate_has_active_interview", {
    p_candidate_id: candidate.id,
  });
  return (
    <div>
      <PageHeader
        title="Documents"
        description="Upload multiple CVs and supporting documents once, then choose which to send with each application."
      />
      <DocumentManager
        candidateId={candidate.id}
        userId={session.userId}
        documents={documents}
        documentsLocked={Boolean(locked)}
      />
    </div>
  );
}
