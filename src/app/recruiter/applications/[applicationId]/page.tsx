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
  Alert,
} from "@/components/ui/primitives";
import { StageBadge, StatusBadge } from "@/components/StatusBadge";
import { getApplicationDetail } from "@/lib/data/recruiter";
import { StageControl, NoteForm, ViewCvButton } from "./Workspace";
import { AiScreeningPanel } from "./AiScreening";
import { stageByKey } from "@/lib/constants";
import { formatDate, formatDateTime, titleCase, initials } from "@/lib/format";
import { FileText, MapPin } from "lucide-react";
import { AssessmentWorkflowPanel } from "@/components/assessments/AssessmentWorkflowPanel";
import { DocumentExportButton } from "@/components/documents/DocumentExportButton";
import { SourcedContactControl } from "@/components/candidates/SourcedContactControl";
import { requireSession } from "@/lib/auth";
import { isHqAdmin } from "@/lib/rbac";
import type { SourcedContactStatus } from "@/lib/database.types";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationWorkspace({
  params,
}: {
  params: { applicationId: string };
}) {
  const detail = await getApplicationDetail(params.applicationId);
  if (!detail) notFound();
  const session = await requireSession();
  const canExportOriginal = isHqAdmin(session.roles);
  const {
    application,
    candidate,
    job,
    history,
    notes,
    documents,
    submissions,
    aiReview,
    aiReviewItems,
    assessmentAssignment,
    assessmentFiles,
    employerSubmissionConsentId,
    acceptedOfferId,
  } = detail;
  const primaryCv = documents.find((d) => d.is_primary) ?? documents[0] ?? null;
  const name = `${candidate?.given_name ?? "Candidate"} ${candidate?.family_name ?? ""}`.trim();

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
        actions={
          application.withdrawn_at ? (
            <Badge tone="neutral">Withdrawn</Badge>
          ) : (
            <StageBadge stageKey={application.current_stage} />
          )
        }
      />

      {application.withdrawn_at ? (
        <div className="mb-4">
          <Alert tone="warn" title="Candidate withdrew">
            This application was withdrawn on {formatDate(application.withdrawn_at)}. It stays out
            of the active pipeline until they reapply —{" "}
            <a href="#stage-history" className="font-medium underline underline-offset-2">
              stage history
            </a>{" "}
            below keeps the full record.
          </Alert>
        </div>
      ) : history.some((h) => h.source === "candidate_reapply") ? (
        <div className="mb-4">
          <Alert tone="info" title="Candidate reapplied">
            This candidate previously withdrew and has reapplied. See{" "}
            <a href="#stage-history" className="font-medium underline underline-offset-2">
              stage history
            </a>{" "}
            for the full timeline.
          </Alert>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
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
                      <div className="flex shrink-0 items-center gap-1">
                        <ViewCvButton
                          documentId={d.id}
                          applicationId={application.id}
                          label="Preview (view-only)"
                        />
                        {canExportOriginal ? (
                          <DocumentExportButton source="candidate_document" id={d.id} />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-subtle">
                Opens a watermarked, view-only preview. Every access is audited. Original download
                is Super Admin only.
              </p>
            </CardBody>
          </Card>

          <AiScreeningPanel
            applicationId={application.id}
            hasCv={!!application.cv_document_id || !!primaryCv}
            review={aiReview}
            items={aiReviewItems}
          />

          {job ? (
            <AssessmentWorkflowPanel
              applicationId={application.id}
              jobOrderId={job.id}
              currentStage={application.current_stage}
              mode={job.assessment_mode}
              seniority={job.assessment_seniority}
              passThreshold={job.assessment_pass_threshold}
              employerFileName={job.assessment_file_name}
              employerFiles={assessmentFiles.map((file) => ({
                id: file.id,
                file_name: file.file_name,
                kind: file.kind,
              }))}
              assignment={assessmentAssignment}
            />
          ) : null}

          <Card id="stage-history" className="scroll-mt-24">
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
                        {h.from_stage ? `${stageLabel(h.from_stage)} → ` : ""}
                        <span className="font-medium">{stageLabel(h.to_stage)}</span>
                      </p>
                      <p className="text-xs text-ink-subtle">
                        {formatDateTime(h.created_at)} · {historyActorLabel(h)}
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

        <div className="space-y-4">
          <StageControl
            applicationId={application.id}
            currentStage={application.current_stage}
            rejectedFromStage={application.rejected_from_stage}
            rejectionReason={application.rejection_reason}
            withdrawnAt={application.withdrawn_at}
            testName={application.test_name}
            testScore={application.test_score}
            assessmentScore={
              assessmentAssignment?.score != null &&
              ["submitted", "graded"].includes(assessmentAssignment.status) &&
              !assessmentAssignment.human_review_required
                ? Number(assessmentAssignment.score)
                : null
            }
            hasScreeningNotes={notes.some((n) => n.body?.trim())}
            hasEmployerConsent={Boolean(employerSubmissionConsentId)}
            hasAcceptedOffer={Boolean(acceptedOfferId)}
          />

          {!application.is_direct_application ||
          application.entry_source === "recruiter_sourced" ? (
            <SourcedContactControl
              applicationId={application.id}
              status={(application.sourced_contact_status as SourcedContactStatus | null) ?? null}
              contactedAt={application.sourced_contacted_at}
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Employer submission</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {submissions.length === 0 ? (
                <EmptyState
                  title="Not sent yet"
                  description="Moving the candidate to Client Submission automatically sends their masked CV pack to the employer."
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

function stageLabel(key: string): string {
  return stageByKey(key)?.label ?? titleCase(key);
}

function historyActorLabel(h: { actor_role: string | null; source: string | null }): string {
  switch (h.source) {
    case "candidate_withdraw":
      return "Candidate withdrew";
    case "candidate_reapply":
      return "Candidate reapplied";
    case "candidate_apply":
      return "Candidate applied";
    case "candidate_update":
      return "Candidate updated application";
    default:
      return titleCase(h.actor_role ?? h.source);
  }
}
