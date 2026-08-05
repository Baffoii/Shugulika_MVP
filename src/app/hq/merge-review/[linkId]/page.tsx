import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import { DataTable, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getDuplicateLink } from "@/lib/candidates/duplicate-store";
import { loadMergeReviewPair } from "@/lib/candidates/merge-store";
import { MERGEABLE_PROFILE_FIELDS } from "@/lib/candidates/merge";
import { MERGE_STATUS_MESSAGES } from "@/app/hq/merge-review/messages";
import { mergeCandidatesAction, reviewDuplicateAction } from "@/app/hq/merge-review/actions";

export const metadata: Metadata = { title: "Compare records" };
export const dynamic = "force-dynamic";

const FIELD_LABELS: Record<string, string> = {
  given_name: "First name",
  middle_name: "Middle name",
  family_name: "Surname",
  contact_email: "Contact email",
  headline: "Headline",
  summary: "Summary",
  city: "City",
  country_code: "Country",
  date_of_birth: "Date of birth",
  availability: "Availability",
};

function sourceLabel(source: string | null | undefined, confidence: number | null | undefined) {
  if (!source) return "No provenance on file";
  if (source === "candidate_confirmed") return "Confirmed by the candidate";
  if (source === "recruiter_entry") return "Entered by a recruiter";
  const pct = confidence == null ? "" : ` · ${Math.round(confidence * 100)}% confidence`;
  return `${source === "zoho_import" ? "Imported from Zoho" : "Extracted from a CV"}${pct}`;
}

export default async function MergeReviewPairPage({
  params,
  searchParams,
}: {
  params: Promise<{ linkId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePortal("hq");
  const { linkId } = await params;
  const query = await searchParams;
  const statusCode = Array.isArray(query.merge) ? query.merge[0] : query.merge;
  const detail = Array.isArray(query.detail) ? query.detail[0] : query.detail;
  const status = statusCode ? MERGE_STATUS_MESSAGES[statusCode] : undefined;

  const supabase = createClient();
  const link = await getDuplicateLink(supabase, linkId);
  if (!link) notFound();

  // The lower-id record is the default survivor purely so the screen is stable
  // between reloads; the reviewer can swap which one survives.
  const swap = (Array.isArray(query.primary) ? query.primary[0] : query.primary) === "high";
  const primaryId = swap ? link.candidateIdHigh : link.candidateIdLow;
  const duplicateId = swap ? link.candidateIdLow : link.candidateIdHigh;

  const pair = await loadMergeReviewPair(primaryId, duplicateId);
  if (!pair) notFound();

  const conflictFields = new Set(pair.conflicts.map((c) => c.fieldPath));
  const alreadyReviewed = link.status !== "suspected";

  return (
    <div>
      <PageHeader
        title="Compare records"
        description="Two records suspected of being the same person. Nothing here happens automatically: choose a winner for each conflicting field, or dismiss the pair."
        actions={
          <ButtonLink href="/hq/merge-review" variant="secondary">
            Back to queue
          </ButtonLink>
        }
      />

      {status ? (
        <div className="mb-4">
          <Alert tone={status.tone} title={status.title}>
            {detail ? detail : status.text}
          </Alert>
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Why these were flagged</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={link.matchKind === "exact" ? "danger" : "warn"}>
              {link.matchKind === "exact" ? "Exact identifier match" : "Probabilistic match"}
            </Badge>
            <Badge tone="neutral">{Math.round(link.score * 100)}% overall</Badge>
            <Badge tone="neutral">Detected {formatDateTime(link.detectedAt)}</Badge>
            {alreadyReviewed ? <Badge tone="info">Already reviewed: {link.status}</Badge> : null}
          </div>

          {link.signals.length === 0 ? (
            <p className="text-sm text-ink-muted">No comparable signals were recorded.</p>
          ) : (
            <DataTable>
              <THead>
                <TR>
                  <TH>Signal</TH>
                  <TH>This record</TH>
                  <TH>Other record</TH>
                  <TH className="text-right">Similarity</TH>
                </TR>
              </THead>
              <tbody>
                {link.signals.map((signal) => (
                  <TR key={signal.key}>
                    <TD className="font-medium text-ink">{signal.key.replace(/_/g, " ")}</TD>
                    <TD className="text-ink-muted">{signal.a || "—"}</TD>
                    <TD className="text-ink-muted">{signal.b || "—"}</TD>
                    <TD className="text-right">
                      {signal.exact ? (
                        <Badge tone="danger">identical</Badge>
                      ) : (
                        `${Math.round(signal.similarity * 100)}%`
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </Card>

      <form action={mergeCandidatesAction}>
        <input type="hidden" name="linkId" value={link.id} />
        <input type="hidden" name="primaryCandidateId" value={primaryId} />
        <input type="hidden" name="duplicateCandidateId" value={duplicateId} />

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Field by field</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-ink-muted">
                The <strong className="text-ink">surviving record</strong> is on the left. Every
                conflicting field needs a decision before the merge can run.
              </p>
              <Link
                className="text-brand-700 underline"
                href={`/hq/merge-review/${link.id}?primary=${swap ? "low" : "high"}`}
              >
                Swap which record survives
              </Link>
            </div>

            <DataTable>
              <THead>
                <TR>
                  <TH>Field</TH>
                  <TH>Surviving record</TH>
                  <TH>Record being merged away</TH>
                  <TH>Decision</TH>
                </TR>
              </THead>
              <tbody>
                {MERGEABLE_PROFILE_FIELDS.map((field) => {
                  const conflict = pair.conflicts.find((c) => c.fieldPath === field);
                  const primaryValue = pair.primary[field] ?? null;
                  const duplicateValue = pair.duplicate[field] ?? null;
                  if (!primaryValue && !duplicateValue) return null;

                  return (
                    <TR key={field}>
                      <TD className="font-medium text-ink">{FIELD_LABELS[field] ?? field}</TD>
                      <TD>
                        <p className="text-ink">
                          {primaryValue || <em className="text-ink-subtle">empty</em>}
                        </p>
                        {conflict ? (
                          <p className="mt-1 text-xs text-ink-subtle">
                            {sourceLabel(
                              conflict.primarySource?.source,
                              conflict.primarySource?.confidence,
                            )}
                          </p>
                        ) : null}
                      </TD>
                      <TD>
                        <p className="text-ink">
                          {duplicateValue || <em className="text-ink-subtle">empty</em>}
                        </p>
                        {conflict ? (
                          <p className="mt-1 text-xs text-ink-subtle">
                            {sourceLabel(
                              conflict.duplicateSource?.source,
                              conflict.duplicateSource?.confidence,
                            )}
                          </p>
                        ) : null}
                      </TD>
                      <TD>
                        {conflictFields.has(field) && conflict ? (
                          <fieldset className="flex flex-col gap-1">
                            <legend className="sr-only">
                              Choose the winning value for {FIELD_LABELS[field] ?? field}
                            </legend>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name={`decision:${field}`}
                                value="primary"
                                defaultChecked={conflict.recommended === "primary"}
                                required
                              />
                              Keep surviving
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="radio"
                                name={`decision:${field}`}
                                value="duplicate"
                                defaultChecked={conflict.recommended === "duplicate"}
                              />
                              Take other
                            </label>
                            <span className="text-xs text-ink-subtle">
                              Suggested: {conflict.recommendationReason.replace(/_/g, " ")}
                            </span>
                          </fieldset>
                        ) : (
                          <span className="text-xs text-ink-subtle">
                            {primaryValue ? "No conflict" : "Filled from the other record"}
                          </span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>What moves across</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4">
            <p className="mb-3 text-sm text-ink-muted">
              Everything below moves onto the surviving record. The merged-away record is archived,
              not deleted, and the whole operation is captured in a reversible audit entry.
            </p>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {(
                [
                  ["Experience", pair.duplicateChildRows.experiences.length],
                  ["Education", pair.duplicateChildRows.education.length],
                  ["Skills", pair.duplicateChildRows.skills.length],
                  ["Certifications", pair.duplicateChildRows.certifications.length],
                  ["Languages", pair.duplicateChildRows.languages.length],
                  ["Documents", pair.duplicateChildRows.documents.length],
                  ["Applications", pair.duplicateChildRows.applications.length],
                ] as const
              ).map(([label, count]) => (
                <div key={label}>
                  <dt className="text-ink-subtle">{label}</dt>
                  <dd className="font-medium text-ink">{count}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-subtle">
              An application to a job the surviving record already applied to stays where it is —
              the audit records which ones, so they can be reconciled by hand.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Merge</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end">
            <label className="text-sm">
              <span className="mb-1 block text-ink-muted">
                Type <strong className="text-ink">merge</strong> to confirm
              </span>
              <input
                name="confirm"
                autoComplete="off"
                className="w-40 rounded-md border border-surface-border bg-white px-3 py-2 text-sm text-ink"
              />
            </label>
            <Button type="submit" variant="danger">
              Merge these records
            </Button>
          </div>
        </Card>
      </form>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Not the same person?</CardTitle>
        </CardHeader>
        <form action={reviewDuplicateAction} className="flex flex-col gap-3 px-4 pb-4">
          <input type="hidden" name="linkId" value={link.id} />
          <input type="hidden" name="verdict" value="not_duplicate" />
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">Note (optional)</span>
            <input
              name="note"
              className="w-full rounded-md border border-surface-border bg-white px-3 py-2 text-sm text-ink"
              placeholder="e.g. siblings sharing a household phone number"
            />
          </label>
          <div>
            <Button type="submit" variant="outline">
              Mark as different people
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
