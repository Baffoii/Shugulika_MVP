"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { applyToJobAction, type ActionResult } from "@/app/candidate/actions";
import { Card, CardHeader, CardTitle, CardBody, Button, Alert, ButtonLink } from "@/components/ui/primitives";
import { Field, Select, Checkbox } from "@/components/ui/form";
import { CheckCircle2 } from "lucide-react";
import type { CandidateDocumentRow, JobScreeningQuestionRow } from "@/lib/database.types";

const initial: ActionResult = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} className="w-full sm:w-auto">{pending ? "Submitting…" : "Submit application"}</Button>;
}

export function ApplyForm({
  jobOrderId,
  jobTitle,
  employerName,
  cvs,
  questions,
}: {
  jobOrderId: string;
  jobTitle: string;
  employerName: string;
  cvs: CandidateDocumentRow[];
  questions: JobScreeningQuestionRow[];
}) {
  const [state, action] = useFormState(applyToJobAction, initial);

  if (state.ok) {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-ink">Application submitted</h2>
        <p className="mt-1 text-sm text-ink-muted">{jobTitle} · {employerName}</p>
        <div className="mt-5 flex justify-center gap-2">
          <ButtonLink href="/candidate/applications" size="sm">View my applications</ButtonLink>
          <ButtonLink href="/candidate/jobs" variant="outline" size="sm">Keep browsing</ButtonLink>
        </div>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="job_order_id" value={jobOrderId} />
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Card>
        <CardHeader><CardTitle>Choose your CV</CardTitle></CardHeader>
        <CardBody>
          {cvs.length === 0 ? (
            <Alert tone="warn">
              You don&apos;t have a CV uploaded.{" "}
              <Link href="/candidate/documents" className="font-medium underline">Upload one first</Link> to apply.
            </Alert>
          ) : (
            <Field label="CV to send" htmlFor="cv">
              <Select id="cv" name="cv_document_id" defaultValue={cvs.find((c) => c.is_primary)?.id ?? cvs[0]?.id}>
                {cvs.map((c) => (
                  <option key={c.id} value={c.id}>{c.title ?? c.object_path.split("/").pop()}{c.is_primary ? " (primary)" : ""}</option>
                ))}
              </Select>
            </Field>
          )}
        </CardBody>
      </Card>

      {questions.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Employer questions</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {questions.map((q) => (
              <div key={q.id} className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
                <p className="font-medium text-ink">{q.prompt}{q.is_required ? " *" : ""}</p>
                <p className="mt-0.5 text-xs text-ink-subtle">Captured with your application.</p>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Consent</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-muted">Each permission is separate and recorded with a timestamp. You can withdraw consent later.</p>
          <Checkbox name="consent_process" label="I agree that Shugulika may process this application for this role." />
          <Checkbox name="consent_share" label="I agree to share my selected CV and application profile with the recruitment team handling this role." />
          <div className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-subtle">
            Note: submitting your profile to a specific employer requires a separate, employer-specific consent later — general consent here is not enough for that step.
          </div>
          <Checkbox name="accurate" label="I confirm the information in this application is accurate." />
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton />
        <ButtonLink href="/candidate/jobs" variant="ghost" size="sm">Cancel</ButtonLink>
      </div>
    </form>
  );
}
