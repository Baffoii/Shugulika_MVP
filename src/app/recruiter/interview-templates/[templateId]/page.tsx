import Link from "next/link";
import { notFound } from "next/navigation";
import { getInterviewTemplate } from "@/lib/data/video-interviews";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import { formatClock } from "@/lib/interview-analytics";
import { EditTemplateForm, QuestionManager } from "../TemplateForms";

export const metadata = { title: "Interview template" };

export default async function InterviewTemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const template = await getInterviewTemplate(templateId);
  if (!template) notFound();
  return (
    <div>
      <Link
        href="/recruiter/interview-templates"
        className="text-sm text-brand-700 hover:underline"
      >
        ← Back to templates
      </Link>
      <PageHeader
        title={template.name}
        description={`${template.questions.length} question${template.questions.length === 1 ? "" : "s"} · Changes only affect future assignments.`}
        actions={
          <Badge tone={template.is_active ? "success" : "neutral"}>
            {template.is_active ? "Active" : "Archived"}
          </Badge>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
        <EditTemplateForm template={template} />
        <QuestionManager templateId={template.id} questions={template.questions} />
      </div>
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Candidate experience preview</CardTitle>
          <Badge tone="neutral">Preview only</Badge>
        </CardHeader>
        <CardBody className="space-y-4">
          {template.instructions ? (
            <p className="rounded-lg bg-surface-muted p-3 text-sm text-ink-muted">
              {template.instructions}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="neutral">
              {template.allow_pause_between_questions
                ? "Breaks between questions allowed"
                : "Continuous questions (no break)"}
            </Badge>
            <Badge tone="neutral">
              {template.allow_response_review
                ? "Candidates may review before submit"
                : "Auto-submit recording (no review)"}
            </Badge>
            <Badge tone="neutral">{template.default_deadline_days}d suggested deadline</Badge>
            <Badge tone="neutral">{template.expiration_grace_hours}h grace after deadline</Badge>
          </div>
          {template.questions.length ? (
            <ol className="space-y-3">
              {template.questions.map((question, index) => {
                const preparation =
                  question.preparation_seconds ?? template.default_preparation_seconds;
                const response = question.response_seconds ?? template.default_response_seconds;
                const attempts = question.max_attempts ?? template.default_max_attempts;
                return (
                  <li key={question.id} className="rounded-lg border border-surface-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                        Question {index + 1} of {template.questions.length}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {question.is_required ? <Badge tone="brand">Required</Badge> : null}
                        <Badge tone="neutral">{formatClock(preparation)} prep</Badge>
                        <Badge tone="neutral">{formatClock(response)} response</Badge>
                        <Badge tone="neutral">
                          {attempts} attempt{attempts === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    </div>
                    <p className="mt-2 font-medium text-ink">{question.question_text}</p>
                    {question.guidance ? (
                      <p className="mt-1 text-sm text-ink-muted">{question.guidance}</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-ink-subtle">
              Add a question to preview the candidate experience.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
