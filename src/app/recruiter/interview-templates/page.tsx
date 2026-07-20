import Link from "next/link";
import { listInterviewTemplates } from "@/lib/data/video-interviews";
import { formatDate } from "@/lib/format";
import { Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CreateTemplateForm } from "./TemplateForms";

export const metadata = { title: "Interview templates" };

export default async function InterviewTemplatesPage() {
  const templates = await listInterviewTemplates();
  return (
    <div>
      <PageHeader
        title="Interview templates"
        description="Create reusable question sets for asynchronous candidate video interviews."
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
        <CreateTemplateForm />
      </div>
    </div>
  );
}
