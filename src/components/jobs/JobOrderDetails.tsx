"use client";

import { useState } from "react";
import type { JobOrderRow } from "@/lib/database.types";
import { Badge } from "@/components/ui/primitives";
import { TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatMoney, titleCase } from "@/lib/format";

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <div className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{children}</div>
    </div>
  );
}

function JobOrderDetailsPanel({ job }: { job: JobOrderRow }) {
  const salary =
    job.salary_min != null || job.salary_max != null
      ? [
          job.salary_min != null ? formatMoney(job.salary_min, job.salary_currency) : null,
          job.salary_max != null ? formatMoney(job.salary_max, job.salary_currency) : null,
        ]
          .filter(Boolean)
          .join(" – ")
      : null;

  return (
    <div className="space-y-3 rounded-lg border border-surface-border bg-surface-muted/60 p-4">
      <DetailBlock label="Description">
        {job.description?.trim() || "No description provided."}
      </DetailBlock>
      <DetailBlock label="Requirements">
        {job.requirements?.trim() || "No requirements provided."}
      </DetailBlock>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DetailBlock label="Department">{job.department}</DetailBlock>
        <DetailBlock label="Employment type">
          {job.employment_type ? titleCase(job.employment_type) : null}
        </DetailBlock>
        <DetailBlock label="Work arrangement">
          {job.work_arrangement ? titleCase(job.work_arrangement) : null}
        </DetailBlock>
        <DetailBlock label="Experience">
          {job.experience_level ? titleCase(job.experience_level) : null}
        </DetailBlock>
        <DetailBlock label="Salary">{salary}</DetailBlock>
        <DetailBlock label="Deadline">
          {job.application_deadline ? formatDate(job.application_deadline) : null}
        </DetailBlock>
      </div>
    </div>
  );
}

const COLUMN_COUNT = 7;

/** Job-order table row with a full-width details panel that drops under the row. */
export function JobOrderListRow({
  job,
  workflow,
}: {
  job: JobOrderRow;
  workflow?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TR>
        <TD>
          <p className="font-medium text-ink">{job.title}</p>
          <button
            type="button"
            className="mt-1.5 text-xs font-medium text-brand-700 hover:text-brand-800"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? "Hide role details" : "View role details"}
          </button>
        </TD>
        <TD className="text-ink-muted">
          {[job.city, job.country_code].filter(Boolean).join(", ")}
        </TD>
        <TD>
          <Badge tone={job.recruitment_path === "A" ? "info" : "success"}>
            {job.recruitment_path === "A" ? "Direct" : "Managed"}
          </Badge>
        </TD>
        <TD>
          <StatusBadge status={job.status} />
        </TD>
        <TD className="text-ink-muted">{job.vacancy_count}</TD>
        <TD className="text-ink-muted">{formatDate(job.created_at)}</TD>
        <TD className="min-w-64">{workflow}</TD>
      </TR>
      {open ? (
        <TR className="border-t-0">
          <TD colSpan={COLUMN_COUNT} className="bg-surface-muted/30 px-4 pb-4 pt-0">
            <JobOrderDetailsPanel job={job} />
          </TD>
        </TR>
      ) : null}
    </>
  );
}
