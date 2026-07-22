import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Badge,
  Alert,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient } from "@/lib/supabase/server";
import { getSubmissionDetail } from "@/lib/data/staff";
import { DecisionPanel, CommentForm } from "./DecisionPanel";
import { ViewCvButton } from "@/components/documents/ViewCvButton";
import { formatDate } from "@/lib/format";
import { FileText } from "lucide-react";
import type { CandidateDocumentRow, EmployerCommentRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Submission" };

type Disclosed = {
  full_name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  headline?: string | null;
  location?: string | null;
  summary?: string | null;
  availability?: string | null;
  test_name?: string | null;
  test_score?: string | null;
};

export default async function SubmissionDetailPage({
  params,
}: {
  params: { submissionId: string };
}) {
  const sub = await getSubmissionDetail(params.submissionId);
  if (!sub) notFound();
  const supabase = createClient();
  const [{ data: comments }, { data: cvDoc }] = await Promise.all([
    supabase
      .from("employer_comments")
      .select("*")
      .eq("submission_id", sub.id)
      .order("created_at", { ascending: false }),
    sub.cv_document_id
      ? supabase.from("candidate_documents").select("*").eq("id", sub.cv_document_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const disclosed = (sub.disclosed_profile ?? {}) as Disclosed;
  const fullName =
    disclosed.full_name?.trim() ||
    [disclosed.given_name, disclosed.family_name].filter(Boolean).join(" ").trim() ||
    null;
  const testLabel = disclosed.test_name?.trim() || "Skills assessment";
  const testScore = disclosed.test_score?.trim() || "N/A";
  const cv = cvDoc as CandidateDocumentRow | null;

  return (
    <div>
      <Link href="/employer/submissions" className="text-sm text-brand-700 hover:underline">
        ← Back to submissions
      </Link>
      <PageHeader
        title={fullName ?? "Candidate pack"}
        description={sub.job_orders?.title ? `Submitted for ${sub.job_orders.title}` : undefined}
        actions={<StatusBadge status={sub.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Candidate profile</CardTitle>
              <Badge tone="success">Shared at Client Submission</Badge>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Field label="Name" value={fullName} />
              <Field label="Headline" value={disclosed.headline} />
              <Field label="Location" value={disclosed.location} />
              <Field label="Availability" value={disclosed.availability} />
              <Field label="Summary" value={disclosed.summary} />
              <Field label={testLabel} value={testScore} />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Resume
                </p>
                {cv ? (
                  <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-ink">
                      <FileText className="h-4 w-4 text-ink-subtle" aria-hidden />
                      {cv.title ?? cv.object_path.split("/").pop()}
                    </span>
                    <ViewCvButton
                      bucketId={cv.bucket_id}
                      objectPath={cv.object_path}
                      label="Open CV"
                    />
                  </div>
                ) : (
                  <p className="mt-0.5 text-ink-muted">No resume attached to this submission.</p>
                )}
              </div>
              {sub.summary ? (
                <div className="rounded-lg bg-brand-50/60 px-3 py-2">
                  <p className="text-xs font-medium text-brand-700">Recruiter&apos;s note to you</p>
                  <p className="mt-0.5 text-sm text-brand-900">{sub.summary}</p>
                </div>
              ) : null}
              <Alert tone="info">
                Contact details and internal recruiter notes stay inside Shugulika. Withdrawal of
                the application removes this pack from your view.
              </Alert>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <CommentForm submissionId={sub.id} />
              {((comments as EmployerCommentRow[] | null) ?? []).length === 0 ? (
                <p className="text-sm text-ink-subtle">No comments yet.</p>
              ) : (
                <ul className="space-y-2">
                  {((comments as EmployerCommentRow[] | null) ?? []).map((c) => (
                    <li key={c.id} className="rounded-lg bg-surface-muted p-3">
                      <p className="text-sm text-ink">{c.body}</p>
                      <p className="mt-1 text-2xs text-ink-subtle">{formatDate(c.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Your decision</CardTitle>
            </CardHeader>
            <CardBody>
              <DecisionPanel submissionId={sub.id} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-ink">{value || "—"}</p>
    </div>
  );
}
