"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addQuestionAction,
  archiveTemplateAction,
  createTemplateAction,
  duplicateTemplateAction,
  removeQuestionAction,
  reorderQuestionsAction,
  updateQuestionAction,
  updateTemplateAction,
  type InterviewActionResult,
} from "@/app/recruiter/interview-actions";
import type { InterviewTemplateQuestionRow, InterviewTemplateRow } from "@/lib/database.types";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(
    action: () => Promise<InterviewActionResult>,
    onSuccess?: (result: InterviewActionResult) => void,
  ) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error ?? "Could not save.");
      onSuccess?.(result);
      router.refresh();
    });
  }
  return { pending, error, run };
}

function TemplateFields({ template }: { template?: InterviewTemplateRow }) {
  return (
    <>
      <Field label="Template name" htmlFor="template-name" required>
        <Input
          id="template-name"
          name="name"
          defaultValue={template?.name}
          required
          maxLength={160}
        />
      </Field>
      <Field label="Description" htmlFor="template-description">
        <Textarea
          id="template-description"
          name="description"
          defaultValue={template?.description ?? ""}
        />
      </Field>
      <Field label="Candidate instructions" htmlFor="template-instructions">
        <Textarea
          id="template-instructions"
          name="instructions"
          defaultValue={template?.instructions ?? ""}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Preparation (seconds)" htmlFor="template-preparation">
          <Input
            id="template-preparation"
            name="default_preparation_seconds"
            type="number"
            min={0}
            max={600}
            defaultValue={template?.default_preparation_seconds ?? 30}
            required
          />
        </Field>
        <Field label="Response (seconds)" htmlFor="template-response">
          <Input
            id="template-response"
            name="default_response_seconds"
            type="number"
            min={10}
            max={300}
            defaultValue={template?.default_response_seconds ?? 120}
            required
          />
        </Field>
        <Field label="Maximum attempts" htmlFor="template-attempts">
          <Input
            id="template-attempts"
            name="default_max_attempts"
            type="number"
            min={1}
            max={5}
            defaultValue={template?.default_max_attempts ?? 2}
            required
          />
        </Field>
        <Field
          label="Recording retention (days)"
          htmlFor="template-retention"
          hint="Recordings become eligible for cleanup after this period."
        >
          <Input
            id="template-retention"
            name="retention_days"
            type="number"
            min={1}
            max={3650}
            defaultValue={template?.retention_days ?? 180}
            required
          />
        </Field>
        <Field
          label="Suggested deadline (days)"
          htmlFor="template-deadline-days"
          hint="Used when inviting candidates; recruiters can still set an exact date."
        >
          <Input
            id="template-deadline-days"
            name="default_deadline_days"
            type="number"
            min={1}
            max={90}
            defaultValue={template?.default_deadline_days ?? 7}
            required
          />
        </Field>
        <Field
          label="Expiration grace (hours)"
          htmlFor="template-grace"
          hint="Extra time after the deadline for an already-started session to finish."
        >
          <Input
            id="template-grace"
            name="expiration_grace_hours"
            type="number"
            min={0}
            max={72}
            defaultValue={template?.expiration_grace_hours ?? 0}
            required
          />
        </Field>
      </div>
      <div className="space-y-2 rounded-lg border border-surface-border bg-surface-muted/40 p-3">
        <p className="text-sm font-medium text-ink">Candidate session rules</p>
        <Checkbox
          id="template-allow-pause"
          name="allow_pause_between_questions"
          defaultChecked={template?.allow_pause_between_questions ?? false}
          label="Allow a controlled break between questions"
        />
        <Checkbox
          id="template-allow-review"
          name="allow_response_review"
          defaultChecked={template?.allow_response_review ?? true}
          label="Allow candidates to review recordings before submitting each answer"
        />
      </div>
    </>
  );
}

export function CreateTemplateForm() {
  const router = useRouter();
  const { pending, error, run } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create template</CardTitle>
      </CardHeader>
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(
              () => createTemplateAction(data),
              (result) => result.id && router.push(`/recruiter/interview-templates/${result.id}`),
            );
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <TemplateFields />
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create template"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function EditTemplateForm({ template }: { template: InterviewTemplateRow }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Template settings</CardTitle>
      </CardHeader>
      <CardBody>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            data.set("template_id", template.id);
            run(() => updateTemplateAction(data));
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <TemplateFields template={template} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                const data = new FormData();
                data.set("template_id", template.id);
                run(
                  () => duplicateTemplateAction(data),
                  (result) =>
                    result.id && router.push(`/recruiter/interview-templates/${result.id}`),
                );
              }}
            >
              Duplicate
            </Button>
            {template.is_active ? (
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  if (
                    !window.confirm("Archive this template? Existing assignments are not affected.")
                  )
                    return;
                  const data = new FormData();
                  data.set("template_id", template.id);
                  run(() => archiveTemplateAction(data));
                }}
              >
                Archive
              </Button>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function QuestionFields({ question }: { question?: InterviewTemplateQuestionRow }) {
  return (
    <>
      <Field label="Question" required>
        <Textarea
          name="question_text"
          defaultValue={question?.question_text}
          required
          maxLength={2000}
        />
      </Field>
      <Field label="Candidate guidance">
        <Textarea
          name="guidance"
          defaultValue={question?.guidance ?? ""}
          className="min-h-[64px]"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Preparation override" hint="Blank uses template default">
          <Input
            name="preparation_seconds"
            type="number"
            min={0}
            max={600}
            defaultValue={question?.preparation_seconds ?? ""}
          />
        </Field>
        <Field label="Response override" hint="Blank uses template default">
          <Input
            name="response_seconds"
            type="number"
            min={10}
            max={300}
            defaultValue={question?.response_seconds ?? ""}
          />
        </Field>
        <Field label="Attempts override" hint="Blank uses template default">
          <Input
            name="max_attempts"
            type="number"
            min={1}
            max={5}
            defaultValue={question?.max_attempts ?? ""}
          />
        </Field>
      </div>
      <Checkbox
        name="is_required"
        label="Required question"
        defaultChecked={question?.is_required ?? true}
      />
    </>
  );
}

export function QuestionManager({
  templateId,
  questions,
}: {
  templateId: string;
  questions: InterviewTemplateQuestionRow[];
}) {
  const { pending, error, run } = useAction();
  function move(index: number, delta: number) {
    const reordered = [...questions];
    const target = index + delta;
    if (target < 0 || target >= reordered.length) return;
    const current = reordered[index];
    const other = reordered[target];
    if (!current || !other) return;
    reordered[index] = other;
    reordered[target] = current;
    const data = new FormData();
    data.set("template_id", templateId);
    data.set("question_ids", reordered.map((q) => q.id).join(","));
    run(() => reorderQuestionsAction(data));
  }
  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {questions.map((question, index) => (
        <Card key={question.id}>
          <CardHeader>
            <CardTitle>Question {index + 1}</CardTitle>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending || index === questions.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                data.set("template_id", templateId);
                data.set("question_id", question.id);
                run(() => updateQuestionAction(data));
              }}
            >
              <QuestionFields question={question} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  Save question
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm("Remove this question?")) return;
                    const data = new FormData();
                    data.set("template_id", templateId);
                    data.set("question_id", question.id);
                    run(() => removeQuestionAction(data));
                  }}
                >
                  Remove
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Add question</CardTitle>
        </CardHeader>
        <CardBody>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              data.set("template_id", templateId);
              run(
                () => addQuestionAction(data),
                () => form.reset(),
              );
            }}
          >
            <QuestionFields />
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add question"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
