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
import { requireEmployerSubscription } from "@/lib/auth";
import { getSubmissionDetail } from "@/lib/data/staff";
import { DecisionPanel, CommentForm } from "./DecisionPanel";
import { ViewCvButton } from "@/components/documents/ViewCvButton";
import { UnlockCvButton } from "../UnlockCvButton";
import { formatDate } from "@/lib/format";
import {
  getEmployerPlanSnapshot,
  isCandidateUnlocked,
  type FullDisclosedProfile,
} from "@/lib/employer-entitlements";
import { FileText } from "lucide-react";
import type { CandidateDocumentRow, EmployerCommentRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Submission" };

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { employerOrg } = await requireEmployerSubscription();
  const { submissionId } = await params;
  const sub = await getSubmissionDetail(submissionId);
  if (!sub) notFound();

  const [unlocked, plan] = await Promise.all([
    isCandidateUnlocked(employerOrg.id, sub.candidate_id),
    getEmployerPlanSnapshot(employerOrg.id),
  ]);

  const supabase = createClient();
  const [{ data: comments }, { data: cvDoc }] = await Promise.all([
    supabase
      .from("employer_comments")
      .select("*")
      .eq("submission_id", sub.id)
      .order("created_at", { ascending: false }),
    unlocked && sub.cv_document_id
      ? supabase.from("candidate_documents").select("*").eq("id", sub.cv_document_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const teaser = (sub.disclosed_profile ?? {}) as Partial<FullDisclosedProfile>;
  const full = (sub.full_disclosed_profile ?? teaser) as Partial<FullDisclosedProfile>;
  const disclosed = unlocked ? { ...teaser, ...full } : teaser;

  const fullName = unlocked
    ? disclosed.full_name?.trim() ||
      [disclosed.given_name, disclosed.family_name].filter(Boolean).join(" ").trim() ||
      null
    : null;
  const title = fullName ?? disclosed.headline?.trim() ?? "Candidate teaser";
  const testLabel = disclosed.test_name?.trim() || "Skills assessment";
  const testScore = disclosed.test_score?.trim() || "N/A";
  const cv = cvDoc as CandidateDocumentRow | null;

  return (
    <div>
      <Link href="/employer/submissions" className="text-sm text-brand-700 hover:underline">
        ← Back to submissions
      </Link>
      <PageHeader
        title={title}
        description={sub.job_orders?.title ? `Submitted for ${sub.job_orders.title}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            {unlocked ? (
              <Badge tone="success">Unlocked</Badge>
            ) : (
              <Badge tone="warn">Masked teaser</Badge>
            )}
            <StatusBadge status={sub.status} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{unlocked ? "Candidate profile" : "Candidate teaser"}</CardTitle>
              <Badge tone="success">Shared at Client Submission</Badge>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {!unlocked ? (
                <UnlockCvButton
                  candidateId={sub.candidate_id}
                  submissionId={sub.id}
                  balance={plan.cvUnlockBalance}
                />
              ) : null}
              {unlocked ? <Field label="Name" value={fullName} /> : null}
              <Field label="Headline" value={disclosed.headline} />
              <Field label="Location" value={disclosed.location} />
              <Field label="Availability" value={disclosed.availability} />
              <Field label="Summary" value={disclosed.summary} />
              <Field label={testLabel} value={testScore} />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Resume
                </p>
                {unlocked && cv ? (
                  <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2">
                    <span className="flex items-center gap-2 text-sm text-ink">
                      <FileText className="h-4 w-4 text-ink-subtle" aria-hidden />
                      {cv.title ?? cv.object_path.split("/").pop()}
                    </span>
                    <ViewCvButton
                      documentId={cv.id}
                      submissionId={sub.id}
                      label="Preview CV"
                      allowDownload
                    />
                  </div>
                ) : (
                  <p className="mt-0.5 text-ink-muted">
                    {unlocked
                      ? "No resume attached to this submission."
                      : "Unlock to preview or download the watermarked CV."}
                  </p>
                )}
              </div>
              {unlocked && sub.summary ? (
                <div className="rounded-lg bg-brand-50/60 px-3 py-2">
                  <p className="text-xs font-medium text-brand-700">Recruiter&apos;s note to you</p>
                  <p className="mt-0.5 text-sm text-brand-900">{sub.summary}</p>
                </div>
              ) : null}
              <Alert tone="info">
                Contact details and internal recruiter notes stay inside Shugulika. Unlocked CVs can
                be previewed or downloaded as watermarked PDFs — every access is audited.
              </Alert>
            </CardBody>
          </Card>

          {unlocked ? (
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
          ) : null}
        </div>

        <div>
          {unlocked ? (
            <Card>
              <CardHeader>
                <CardTitle>Your decision</CardTitle>
              </CardHeader>
              <CardBody>
                <DecisionPanel submissionId={sub.id} />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Next step</CardTitle>
              </CardHeader>
              <CardBody className="text-sm text-ink-muted">
                Unlock this candidate to leave comments and record a hiring decision.
                {plan.cvUnlockBalance < 1 ? (
                  <p className="mt-2">
                    <Link href="/employer/billing" className="text-brand-700 hover:underline">
                      Buy more CV unlocks
                    </Link>
                  </p>
                ) : null}
              </CardBody>
            </Card>
          )}
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
