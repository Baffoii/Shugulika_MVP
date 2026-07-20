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
  EmptyState,
} from "@/components/ui/primitives";
import { StageBadge, StatusBadge } from "@/components/StatusBadge";
import { getApplicationDetail } from "@/lib/data/recruiter";
import {
  StageControl,
  NoteForm,
  SubmissionButton,
  VideoInterviewCard,
  ViewCvButton,
} from "./Workspace";
import { getAssignmentsForApplication, listInterviewTemplates } from "@/lib/data/video-interviews";
import { hasInterviewSpotlight } from "@/lib/constants";
import { formatDate, formatDateTime, titleCase, initials } from "@/lib/format";
import { FileText, MapPin } from "lucide-react";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationWorkspace({
  params,
}: {
  params: { applicationId: string };
}) {
  const [detail, templates, interviewAssignments] = await Promise.all([
    getApplicationDetail(params.applicationId),
    listInterviewTemplates(),
    getAssignmentsForApplication(params.applicationId),
  ]);
  if (!detail) notFound();
  const { application, candidate, job, history, notes, documents, submissions } = detail;
  const name = `${candidate?.given_name ?? "Candidate"} ${candidate?.family_name ?? ""}`.trim();
  const orgTemplates = templates.filter(
    (template) => template.is_active && template.organization_id === application.owning_org_id,
  );
  const interviewSpotlight = hasInterviewSpotlight(interviewAssignments);

  return (
    <div>
      <Link href="/recruiter/pipeline" className="text-sm text-brand-700 hover:underline">
        ← Back to pipeline
      </Link>
      <PageHeader
        title={name}
        description={
          job
            ? `${job.title} · ${application.recruitment_path === "A" ? "Direct employer" : "Shugulika-managed"}`
            : undefined
        }
        actions={<StageBadge stageKey={application.current_stage} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: candidate + documents + history */}
        <div className="space-y-4 lg:col-span-2">
          {interviewSpotlight ? (
            <VideoInterviewCard
              applicationId={application.id}
              templates={orgTemplates}
              assignments={interviewAssignments}
              layout="spotlight"
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Candidate</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {initials(name)}
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{name}</p>
                  <p className="text-sm text-ink-muted">{candidate?.headline ?? "—"}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-subtle">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />{" "}
                    {[candidate?.city, candidate?.country_code].filter(Boolean).join(", ") || "—"}
                  </p>
                </div>
              </div>
              {candidate?.summary ? (
                <p className="mt-3 text-sm text-ink-muted">{candidate.summary}</p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardBody>
              {documents.length === 0 ? (
                <p className="text-sm text-ink-subtle">No documents shared.</p>
              ) : (
                <ul className="divide-y divide-surface-border">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex items-center gap-2 text-sm text-ink">
                        <FileText className="h-4 w-4 text-ink-subtle" aria-hidden />{" "}
                        {d.title ?? d.object_path.split("/").pop()}
                        {d.is_primary ? <Badge tone="success">Primary CV</Badge> : null}
                      </span>
                      <ViewCvButton
                        bucketId={d.bucket_id}
                        objectPath={d.object_path}
                        label="Open (view-only)"
                      />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-subtle">
                Documents open via a short-lived, logged link. Watermarked previews are an
                integration-pending feature.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stage history</CardTitle>
            </CardHeader>
            <CardBody>
              {history.length === 0 ? (
                <p className="text-sm text-ink-subtle">No changes yet.</p>
              ) : (
                <ol className="relative space-y-3 border-l border-surface-border pl-4">
                  {history.map((h) => (
                    <li key={h.id} className="relative">
                      <span
                        className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500"
                        aria-hidden
                      />
                      <p className="text-sm text-ink">
                        {h.from_stage ? `${titleCase(h.from_stage)} → ` : ""}
                        <span className="font-medium">{titleCase(h.to_stage)}</span>
                      </p>
                      <p className="text-xs text-ink-subtle">
                        {formatDateTime(h.created_at)} · {titleCase(h.actor_role ?? h.source)}
                        {h.reason ? ` · ${h.reason}` : ""}
                      </p>
                      {h.note ? <p className="mt-0.5 text-sm text-ink-muted">{h.note}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right: actions */}
        <div className="space-y-4">
          <StageControl applicationId={application.id} currentStage={application.current_stage} />

          {!interviewSpotlight ? (
            <VideoInterviewCard
              applicationId={application.id}
              templates={orgTemplates}
              assignments={interviewAssignments}
              layout="sidebar"
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Employer submission</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {submissions.length === 0 ? (
                <EmptyState
                  title="Not submitted"
                  description="Prepare a masked, consent-gated submission for the employer."
                />
              ) : (
                <ul className="space-y-2">
                  {submissions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border border-surface-border px-3 py-2 text-sm"
                    >
                      <span>Submission</span>
                      <StatusBadge status={s.status} />
                    </li>
                  ))}
                </ul>
              )}
              <SubmissionButton applicationId={application.id} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recruiter notes</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <NoteForm applicationId={application.id} />
              {notes.length === 0 ? (
                <p className="text-sm text-ink-subtle">No notes yet.</p>
              ) : (
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-lg bg-surface-muted p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <Badge tone="neutral">{titleCase(n.visibility)}</Badge>
                        <span className="text-2xs text-ink-subtle">{formatDate(n.created_at)}</span>
                      </div>
                      <p className="text-sm text-ink">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
