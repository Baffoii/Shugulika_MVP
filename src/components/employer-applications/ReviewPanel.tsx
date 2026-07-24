"use client";

import { useState, useTransition } from "react";
import {
  openEmployerApplicationReviewAction,
  approveEmployerApplicationAction,
  requestEmployerApplicationChangesAction,
  rejectEmployerApplicationAction,
  reassignEmployerApplicationAction,
  addEmployerApplicationNoteAction,
  type ReviewActionResult,
} from "@/app/employer-application-actions";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/form";
import { EMPLOYER_REJECTION_CATEGORIES } from "@/lib/constants";
import { reviewerActionsForStatus } from "@/lib/employer-onboarding";

const FIELD_OPTIONS = [
  ["", "General (no specific field)"],
  ["legal_name", "Registered company name"],
  ["trading_name", "Trading name"],
  ["organization_type", "Organization type"],
  ["industry", "Industry"],
  ["company_size", "Company size"],
  ["year_established", "Year established"],
  ["website", "Website"],
  ["country_code", "Country"],
  ["region", "Region"],
  ["city", "City"],
  ["physical_address", "Physical address"],
  ["postal_address", "Postal address"],
  ["contact_name", "Contact name"],
  ["contact_job_title", "Contact job title"],
  ["contact_email", "Contact email"],
  ["contact_phone", "Contact phone"],
  ["routing", "Shugulika office routing"],
] as const;

type Panel = "changes" | "reject" | "reassign" | "note" | null;

interface ChangeRow {
  field: string;
  instruction: string;
}

export function ReviewPanel({
  applicationId,
  status,
  canReassign,
  assignedOrgId,
  eligibleFranchises,
}: {
  applicationId: string;
  status: string;
  canReassign: boolean;
  assignedOrgId: string | null;
  eligibleFranchises: { id: string; name: string }[];
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [result, setResult] = useState<ReviewActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const [changeMessage, setChangeMessage] = useState("");
  const [changeRows, setChangeRows] = useState<ChangeRow[]>([{ field: "", instruction: "" }]);
  const [rejectCategory, setRejectCategory] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [reapplyAllowed, setReapplyAllowed] = useState(true);
  const [internalNote, setInternalNote] = useState("");
  const [reassignTarget, setReassignTarget] = useState(assignedOrgId ?? "");
  const [noteText, setNoteText] = useState("");

  const { canOpenReview, canDecide } = reviewerActionsForStatus(status);

  const run = (fn: () => Promise<ReviewActionResult>) =>
    startTransition(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) setPanel(null);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review actions</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        {result ? (
          <Alert tone={result.ok ? "success" : "danger"}>{result.message ?? result.error}</Alert>
        ) : null}

        {!canDecide && !canReassign ? (
          <p className="text-sm text-ink-muted">No actions are available in the current status.</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canOpenReview ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => openEmployerApplicationReviewAction(applicationId))}
            >
              Start review
            </Button>
          ) : null}
          {canDecide ? (
            <>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(() => approveEmployerApplicationAction(applicationId))}
              >
                Approve & activate
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setPanel(panel === "changes" ? null : "changes")}
              >
                Request changes
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => setPanel(panel === "reject" ? null : "reject")}
              >
                Reject
              </Button>
            </>
          ) : null}
          {canReassign && canDecide ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setPanel(panel === "reassign" ? null : "reassign")}
            >
              Assign / reassign
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setPanel(panel === "note" ? null : "note")}
          >
            Add internal note
          </Button>
        </div>

        {panel === "changes" ? (
          <div className="space-y-4 rounded-lg border border-surface-border bg-surface-muted/50 p-4">
            <Field label="General explanation for the employer" required>
              <Textarea
                value={changeMessage}
                onChange={(e) => setChangeMessage(e.target.value)}
                placeholder="Explain what needs to change and why."
              />
            </Field>

            <div className="space-y-3">
              <p className="label-base">Required changes</p>
              {changeRows.map((row, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-md border border-surface-border/80 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Select
                        value={row.field}
                        aria-label="Field"
                        onChange={(e) =>
                          setChangeRows((rows) =>
                            rows.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)),
                          )
                        }
                      >
                        {FIELD_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      disabled={changeRows.length === 1}
                      onClick={() => setChangeRows((rows) => rows.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </div>
                  <Textarea
                    className="min-h-[72px]"
                    value={row.instruction}
                    placeholder="What exactly must the employer change?"
                    onChange={(e) =>
                      setChangeRows((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, instruction: e.target.value } : r)),
                      )
                    }
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                disabled={changeRows.length >= 8}
                onClick={() => setChangeRows((rows) => [...rows, { field: "", instruction: "" }])}
              >
                + Add another change
              </Button>
            </div>

            <div className="flex justify-end border-t border-surface-border/70 pt-4">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    requestEmployerApplicationChangesAction(
                      applicationId,
                      changeMessage,
                      changeRows,
                    ),
                  )
                }
              >
                Send back to employer
              </Button>
            </div>
          </div>
        ) : null}

        {panel === "reject" ? (
          <div className="space-y-4 rounded-lg border border-surface-border bg-surface-muted/50 p-4">
            <Field label="Rejection category" required>
              <Select value={rejectCategory} onChange={(e) => setRejectCategory(e.target.value)}>
                <option value="">Select a category</option>
                {EMPLOYER_REJECTION_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Employer-facing reason" required>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="The employer will see this text."
              />
            </Field>
            <Field label="Internal notes (never shown to the employer)">
              <Textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
            </Field>
            <Checkbox
              label="Allow this employer to submit a revised application"
              checked={reapplyAllowed}
              onChange={(e) => setReapplyAllowed(e.target.checked)}
            />
            <div className="flex justify-end border-t border-surface-border/70 pt-4">
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    rejectEmployerApplicationAction(
                      applicationId,
                      rejectCategory,
                      rejectReason,
                      reapplyAllowed,
                      internalNote,
                    ),
                  )
                }
              >
                Reject application
              </Button>
            </div>
          </div>
        ) : null}

        {panel === "reassign" ? (
          <div className="space-y-4 rounded-lg border border-surface-border bg-surface-muted/50 p-4">
            <Field
              label="Responsible office"
              hint="Only offices eligible for the application's geography are listed. Reassignment immediately changes which franchise can access the application."
            >
              <Select value={reassignTarget} onChange={(e) => setReassignTarget(e.target.value)}>
                <option value="">Shugulika HQ (no franchise visibility)</option>
                {eligibleFranchises.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end border-t border-surface-border/70 pt-4">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    reassignEmployerApplicationAction(applicationId, reassignTarget || null),
                  )
                }
              >
                Update assignment
              </Button>
            </div>
          </div>
        ) : null}

        {panel === "note" ? (
          <div className="space-y-4 rounded-lg border border-surface-border bg-surface-muted/50 p-4">
            <Field label="Internal note" hint="Visible to authorized Shugulika staff only.">
              <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            </Field>
            <div className="flex justify-end border-t border-surface-border/70 pt-4">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await addEmployerApplicationNoteAction(applicationId, noteText);
                    if (res.ok) setNoteText("");
                    return res;
                  })
                }
              >
                Save note
              </Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
