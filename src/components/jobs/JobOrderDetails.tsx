"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { JobInterviewBriefRow, JobOrderRow } from "@/lib/database.types";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatMoney, titleCase } from "@/lib/format";
import { CandidateAssessmentFileButton } from "@/components/assessments/CandidateAssessmentFileButton";
import {
  AiInterviewPlanPanel,
  type FrozenAiTemplateRef,
} from "@/components/interviews/AiInterviewPlanPanel";
import { X } from "lucide-react";

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <div className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{children}</div>
    </div>
  );
}

function JobOrderDetailsPanel({
  job,
  aiBrief,
  canGenerateAiPlan,
  frozenAiTemplate,
  onAiPlanGenerated,
}: {
  job: JobOrderRow;
  aiBrief?: JobInterviewBriefRow | null;
  canGenerateAiPlan?: boolean;
  frozenAiTemplate?: FrozenAiTemplateRef | null;
  onAiPlanGenerated?: (info: { templateId: string; jobTitle?: string }) => void;
}) {
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
        <DetailBlock label="Aptitude testing">
          {job.assessment_mode === "both"
            ? "Shugulika and employer assessments"
            : job.assessment_mode === "employer"
              ? "Employer assessment"
              : "Shugulika assessment"}
        </DetailBlock>
        <DetailBlock label="Assessment level">{titleCase(job.assessment_seniority)}</DetailBlock>
        <DetailBlock label="Pass threshold">{`${job.assessment_pass_threshold}%`}</DetailBlock>
        <DetailBlock label="Origin">
          {(job as { origin?: string }).origin === "shugulika_offline"
            ? "Shugulika offline"
            : "Employer online"}
        </DetailBlock>
        {job.status === "denied" ? (
          <DetailBlock label="Denial reason">{job.denial_reason}</DetailBlock>
        ) : null}
        <DetailBlock label="Employer test file">
          {job.assessment_file_name ? (
            <CandidateAssessmentFileButton
              jobOrderId={job.id}
              fileName={job.assessment_file_name}
            />
          ) : null}
        </DetailBlock>
      </div>
      {aiBrief !== undefined ? (
        <div className="pt-2">
          <AiInterviewPlanPanel
            jobOrderId={job.id}
            brief={aiBrief}
            allowGenerate={canGenerateAiPlan}
            frozenTemplate={frozenAiTemplate}
            jobTitle={job.title}
            onGenerated={onAiPlanGenerated}
          />
        </div>
      ) : null}
    </div>
  );
}

const COLUMN_COUNT = 7;
const BANNER_MS = 6000;

/** Job-order table row with a full-width details panel that drops under the row. */
export function JobOrderListRow({
  job,
  workflow,
  aiBrief,
  frozenAiTemplate = null,
  canGenerateAiPlan = false,
}: {
  job: JobOrderRow;
  workflow?: React.ReactNode;
  /** Pass null when no brief exists yet; omit to hide the AI brief editor. */
  aiBrief?: JobInterviewBriefRow | null;
  frozenAiTemplate?: FrozenAiTemplateRef | null;
  canGenerateAiPlan?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [optimisticFrozen, setOptimisticFrozen] = useState<FrozenAiTemplateRef | null>(null);
  const effectiveFrozen = optimisticFrozen ?? frozenAiTemplate;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (frozenAiTemplate) setOptimisticFrozen(null);
  }, [frozenAiTemplate]);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [banner]);

  function handleAiPlanGenerated(info: { templateId: string; jobTitle?: string }) {
    const title = info.jobTitle ?? job.title;
    setOptimisticFrozen({
      id: info.templateId,
      name: `AI voice — ${title}`.slice(0, 160),
    });
    setOpen(false);
    setBanner(
      `AI voice plan standardized for ${title} — assign it from Interview templates or the candidate application.`,
    );
  }

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
            <JobOrderDetailsPanel
              job={job}
              aiBrief={aiBrief}
              canGenerateAiPlan={canGenerateAiPlan}
              frozenAiTemplate={effectiveFrozen}
              onAiPlanGenerated={handleAiPlanGenerated}
            />
          </TD>
        </TR>
      ) : null}
      {mounted && banner
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4"
              aria-live="polite"
            >
              <div className="pointer-events-auto relative w-full max-w-xl shadow-lg">
                <Alert tone="success" title="AI voice plan ready">
                  <div className="pr-8">{banner}</div>
                </Alert>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-2 h-8 w-8 p-0"
                  aria-label="Dismiss"
                  onClick={() => setBanner(null)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
