"use client";

import type { ReactNode } from "react";
import { Input, Select } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { JobScreeningQuestionRow } from "@/lib/database.types";

function parseOptions(options: JobScreeningQuestionRow["options"]): string[] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.map((o) => String(o));
  }
  return [];
}

function QuestionShell({
  prompt,
  required,
  error,
  children,
}: {
  prompt: string;
  required: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-ink">{prompt}</p>
      {required ? (
        <p className="mt-1 text-xs font-semibold text-status-danger">Required</p>
      ) : null}
      <div className="mt-3">{children}</div>
      {error ? (
        <p className="mt-2 text-xs font-medium text-status-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function BooleanChoice({
  name,
  required,
}: {
  name: string;
  required: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(
        [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ] as const
      ).map((opt) => (
        <label key={opt.value} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={opt.value}
            required={required}
            className="peer sr-only"
          />
          <span
            className={cn(
              "flex w-full items-center justify-center rounded-lg border border-surface-border bg-white px-4 py-3 text-sm font-medium text-ink transition-colors",
              "peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-800",
              "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500",
              "hover:bg-surface-muted",
            )}
          >
            {opt.label}
          </span>
        </label>
      ))}
    </div>
  );
}

export function ScreeningQuestionField({
  question,
  error,
}: {
  question: JobScreeningQuestionRow;
  error?: string;
}) {
  const name = `answer_${question.id}`;
  const options = parseOptions(question.options);

  let control: ReactNode;
  switch (question.qtype) {
    case "boolean":
      control = <BooleanChoice name={name} required={question.is_required} />;
      break;
    case "single_choice":
      control = (
        <Select id={name} name={name} defaultValue="" required={question.is_required}>
          <option value="" disabled>
            Select an option
          </option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      );
      break;
    case "multi_choice":
      control = (
        <div className="space-y-2">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name={name}
                value={opt}
                className="h-4 w-4 rounded border-surface-border text-brand-600 focus:ring-brand-500"
              />
              {opt}
            </label>
          ))}
        </div>
      );
      break;
    case "numeric":
      control = (
        <Input
          id={name}
          name={name}
          type="number"
          min={0}
          step="any"
          required={question.is_required}
          placeholder="Enter a number"
        />
      );
      break;
    default:
      control = (
        <Input
          id={name}
          name={name}
          type="text"
          required={question.is_required}
          placeholder="Your answer"
        />
      );
  }

  return (
    <QuestionShell prompt={question.prompt} required={question.is_required} error={error}>
      {control}
    </QuestionShell>
  );
}

export function EmployerQuestionsSection({
  employerName,
  questions,
  fieldErrors,
}: {
  employerName: string;
  questions: JobScreeningQuestionRow[];
  fieldErrors?: Record<string, string>;
}) {
  if (questions.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ink">Employer questions</h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          Asked by {employerName} for this role.
        </p>
      </div>
      {questions.map((q) => (
        <ScreeningQuestionField
          key={q.id}
          question={q}
          error={fieldErrors?.[`answer_${q.id}`]}
        />
      ))}
    </section>
  );
}
