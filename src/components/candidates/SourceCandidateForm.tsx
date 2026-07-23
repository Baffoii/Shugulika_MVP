"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sourceCandidateAction } from "@/app/recruiter/sourcing-actions";
import { Field, Select } from "@/components/ui/form";
import { Alert, Button } from "@/components/ui/primitives";

type SourceableJob = {
  id: string;
  title: string;
  city: string | null;
  country_code: string;
  status: string;
};

export function SourceCandidateForm({
  candidateId,
  candidateName,
  jobs,
}: {
  candidateId: string;
  candidateName: string;
  jobs: SourceableJob[];
}) {
  const router = useRouter();
  const [jobOrderId, setJobOrderId] = useState(jobs[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [needsReopen, setNeedsReopen] = useState(false);
  const [pending, start] = useTransition();

  function submit(reopenIfClosed = false) {
    setError(null);
    setDuplicateId(null);
    start(async () => {
      const result = await sourceCandidateAction({
        candidateId,
        jobOrderId,
        reopenIfClosed,
      });
      if (result.ok && result.applicationId) {
        router.push(`/recruiter/applications/${result.applicationId}`);
        return;
      }
      if (result.duplicate && result.applicationId) {
        setDuplicateId(result.applicationId);
        setNeedsReopen(
          Boolean(result.error?.includes("withdrawn") || result.error?.includes("rejected")),
        );
      }
      setError(result.error ?? "Could not source candidate.");
    });
  }

  if (jobs.length === 0) {
    return (
      <Alert tone="warn" title="No open jobs">
        Approve or open a job order before sourcing candidates from the talent pool.
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert
          tone={duplicateId ? "warn" : "danger"}
          title={duplicateId ? "Already on this job" : "Could not source"}
        >
          <p>{error}</p>
          {duplicateId && !needsReopen ? (
            <p className="mt-2">
              <Link
                href={`/recruiter/applications/${duplicateId}`}
                className="font-medium text-brand-700 underline"
              >
                Open existing application
              </Link>
            </p>
          ) : null}
          {duplicateId && needsReopen ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => submit(true)}>
                {pending ? "Reopening…" : "Reopen as sourced"}
              </Button>
              <Link
                href={`/recruiter/applications/${duplicateId}`}
                className="inline-flex items-center text-sm font-medium text-brand-700 underline"
              >
                View existing
              </Link>
            </div>
          ) : null}
        </Alert>
      ) : null}

      <Field label="Source onto job" htmlFor="source-job" required>
        <Select
          id="source-job"
          value={jobOrderId}
          onChange={(e) => {
            setJobOrderId(e.target.value);
            setError(null);
            setDuplicateId(null);
            setNeedsReopen(false);
          }}
        >
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
              {j.city ? ` · ${j.city}` : ""} ({j.status})
            </option>
          ))}
        </Select>
      </Field>
      <Button type="button" disabled={pending || !jobOrderId} onClick={() => submit(false)}>
        {pending ? "Sourcing…" : `Source ${candidateName}`}
      </Button>
      <p className="text-xs text-ink-subtle">
        Creates a sourced application in CV Review with status Not contacted. Private franchise
        records from other orgs are never shared.
      </p>
    </div>
  );
}
