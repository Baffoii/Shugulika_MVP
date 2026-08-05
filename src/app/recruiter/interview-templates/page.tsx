import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listInterviewTemplates } from "@/lib/data/video-interviews";
import { getJobOrders } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";
import { Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CreateTemplateForm } from "./TemplateForms";
import { GenerateAiPlanCard, type AiPlanJobOption } from "./GenerateAiPlanCard";
import type { JobInterviewBriefRow } from "@/lib/database.types";

export const metadata = { title: "Interview templates" };

export default async function InterviewTemplatesPage() {
  const [templates, jobs] = await Promise.all([listInterviewTemplates(), getJobOrders()]);
  const supabase = createClient();
  const jobIds = jobs.map((job) => job.id);
  const { data: briefRows } = jobIds.length
    ? await supabase
        .from("job_interview_briefs")
        .select("job_order_id, use_ai_voice")
        .in("job_order_id", jobIds)
        .eq("use_ai_voice", true)
    : { data: [] };
  const briefJobIds = new Set(
    ((briefRows as Pick<JobInterviewBriefRow, "job_order_id" | "use_ai_voice">[] | null) ?? []).map(
      (brief) => brief.job_order_id,
    ),
  );
  const jobOptions: AiPlanJobOption[] = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    status: job.status,
    hasAiBrief: briefJobIds.has(job.id),
  }));

  return (
    <div>
      <PageHeader
        title="Interview templates"
        description="Reusable async video templates and standardized AI voice interview plans."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
        <div className="space-y-3">
          {templates.length ? (
            templates.map((template) => (
              <Link
                key={template.id}
                href={`/recruiter/interview-templates/${template.id}`}
                className="block"
              >
                <Card className="transition-colors hover:border-brand-300">
                  <CardBody className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-ink">{template.name}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                        {template.description || "No description"}
                      </p>
                      <p className="mt-2 text-xs text-ink-subtle">
                        Updated {formatDate(template.updated_at)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge
                          tone={template.interview_mode === "live_ai_voice" ? "brand" : "neutral"}
                        >
                          {template.interview_mode === "live_ai_voice" ? "AI voice" : "Async video"}
                        </Badge>
                        {template.interview_mode === "live_ai_voice" ? (
                          <Badge tone={template.plan_status === "frozen" ? "success" : "warn"}>
                            {template.plan_status === "frozen"
                              ? "standardized"
                              : template.plan_status}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <Badge tone={template.is_active ? "success" : "neutral"}>
                      {template.is_active ? "Active" : "Archived"}
                    </Badge>
                  </CardBody>
                </Card>
              </Link>
            ))
          ) : (
            <EmptyState
              title="No interview templates"
              description="Create your first reusable question set."
            />
          )}
        </div>
        <div className="space-y-5">
          <GenerateAiPlanCard jobs={jobOptions} />
          <CreateTemplateForm />
        </div>
      </div>
    </div>
  );
}
