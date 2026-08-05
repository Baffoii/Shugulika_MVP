import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import {
  applicationRoleLabel,
  getMyApplications,
  getMyCandidate,
  getMyCvShareEvents,
  getMyDocuments,
  getMyVisibleEvents,
} from "@/lib/data/candidate";
import { CANDIDATE_FACING_STATUS } from "@/lib/constants";
import { formatDateTime, titleCase } from "@/lib/format";
import { CvShareButton } from "./CvShareButton";

export const metadata: Metadata = { title: "Application progress" };

export default async function CandidateApplicationProgressPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const candidate = await getMyCandidate();
  if (!candidate) notFound();
  const [apps, events, documents, cvShares] = await Promise.all([
    getMyApplications(candidate.id),
    getMyVisibleEvents(candidate.id, applicationId),
    getMyDocuments(candidate.id),
    getMyCvShareEvents(candidate.id, applicationId),
  ]);
  const application = apps.find((item) => item.id === applicationId);
  if (!application) notFound();
  const cvs = documents.filter((document) => document.doc_type === "cv");
  const selectedCv =
    cvs.find((document) => document.id === application.cv_document_id) ??
    cvs.find((document) => document.is_primary) ??
    cvs[0];
  const documentTitles = new Map(
    documents.map((document) => [document.id, document.title || "CV"] as const),
  );
  const employerLabel = application.job_orders?.is_confidential
    ? "Confidential employer"
    : application.job_orders?.organizations?.name || "Employer";

  return (
    <div>
      <PageHeader
        title={applicationRoleLabel(application)}
        description="A candidate-safe timeline and a record of what you chose to share."
        actions={
          <ButtonLink href="/candidate/applications" variant="outline" size="sm">
            Back to applications
          </ButtonLink>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Application timeline</CardTitle>
            <Badge tone="info">
              {CANDIDATE_FACING_STATUS[application.current_stage] ??
                titleCase(application.current_stage)}
            </Badge>
          </CardHeader>
          <CardBody>
            {events.length ? (
              <ol className="space-y-4">
                {events.map((event) => (
                  <li key={event.id} className="border-l-2 border-brand-200 pl-4">
                    <p className="text-sm font-medium text-ink">{event.label}</p>
                    <p className="text-xs text-ink-subtle">{formatDateTime(event.occurred_at)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="Application received"
                description="Your next candidate-visible update will appear here."
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Send CV securely</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-muted">
              This creates job-specific consent and sends a protected portal link to {employerLabel}
              . Raw CV files are never attached to WhatsApp.
            </p>
            {selectedCv ? (
              <>
                <p className="text-sm text-ink">
                  Selected: <span className="font-medium">{selectedCv.title || "CV"}</span>
                </p>
                <CvShareButton applicationId={application.id} documentId={selectedCv.id} />
              </>
            ) : (
              <Alert tone="warn">
                Upload a CV in Documents before sharing it for this application.
              </Alert>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>CV sharing history</CardTitle>
        </CardHeader>
        <CardBody>
          {cvShares.length ? (
            <ul className="space-y-3">
              {cvShares.map((share) => (
                <li key={share.id} className="rounded-lg border border-surface-border p-3 text-sm">
                  <p className="font-medium text-ink">
                    {documentTitles.get(share.document_id) ?? "CV"} shared with {employerLabel}
                  </p>
                  <p className="text-ink-muted">For: {applicationRoleLabel(application)}</p>
                  <p className="text-ink-muted">Why: document sharing for this job application</p>
                  <p className="text-xs text-ink-subtle">
                    {formatDateTime(share.created_at)} · Secure portal link
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">No CV has been shared for this application.</p>
          )}
        </CardBody>
      </Card>

      <Alert tone="neutral" title="Privacy boundary">
        This timeline never contains recruiter notes, AI reviews, employer deliberations, or another
        candidate&apos;s information.
      </Alert>
    </div>
  );
}
