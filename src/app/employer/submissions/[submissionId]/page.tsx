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
import { formatDate } from "@/lib/format";
import { Lock } from "lucide-react";
import type { EmployerCommentRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Submission" };

type Disclosed = {
  headline?: string | null;
  location?: string | null;
  summary?: string | null;
  availability?: string | null;
};

export default async function SubmissionDetailPage({
  params,
}: {
  params: { submissionId: string };
}) {
  const sub = await getSubmissionDetail(params.submissionId);
  if (!sub) notFound();
  const supabase = createClient();
  const { data: comments } = await supabase
    .from("employer_comments")
    .select("*")
    .eq("submission_id", sub.id)
    .order("created_at", { ascending: false });
  const disclosed = (sub.disclosed_profile ?? {}) as Disclosed;

  return (
    <div>
      <Link href="/employer/submissions" className="text-sm text-brand-700 hover:underline">
        ← Back to submissions
      </Link>
      <PageHeader
        title={`Candidate ${sub.id.slice(0, 8)}`}
        description={sub.job_orders?.title ? `Submitted for ${sub.job_orders.title}` : undefined}
        actions={<StatusBadge status={sub.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Masked candidate profile</CardTitle>
              <Badge tone="neutral">
                <Lock className="mr-1 h-3 w-3" /> Identity hidden
              </Badge>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Field label="Headline" value={disclosed.headline} />
              <Field label="Location" value={disclosed.location} />
              <Field label="Availability" value={disclosed.availability} />
              <Field label="Summary" value={disclosed.summary} />
              {sub.summary ? (
                <div className="rounded-lg bg-brand-50/60 px-3 py-2">
                  <p className="text-xs font-medium text-brand-700">Recruiter&apos;s note to you</p>
                  <p className="mt-0.5 text-sm text-brand-900">{sub.summary}</p>
                </div>
              ) : null}
              <Alert tone="info">
                Full name, contact details, references, and recruiter notes are hidden. They&apos;re
                revealed only after the candidate consents to share them with your organization. A
                watermarked CV preview is an integration-pending feature.
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
