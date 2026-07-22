"use client";

import { useState, useTransition } from "react";
import { Check, X, Pencil } from "lucide-react";
import { acceptSuggestionAction, rejectSuggestionAction } from "@/app/candidate/resume-actions";
import { Button, Alert } from "@/components/ui/primitives";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/form";
import { formatDate } from "@/lib/format";
import { COUNTRIES, LANGUAGE_PROFICIENCIES } from "@/lib/constants";
import { normalizeLanguageProficiency } from "@/lib/validation";
import { ConfidenceBadge } from "@/components/profile/ConfidenceBadge";
import type { ResumeFieldSuggestionRow } from "@/lib/database.types";

type ExperienceValue = {
  title: string;
  employer_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  description: string | null;
};
type EducationValue = {
  institution: string;
  qualification: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
};
type SkillValue = { name: string };
type CertificationValue = { name: string; issuer: string | null; issued_on: string | null };
type LanguageValue = { language: string; proficiency: string | null };

const PROFILE_FIELD_LABEL: Record<string, string> = {
  given_name: "First name",
  middle_name: "Middle name",
  family_name: "Last name",
  phone: "Phone number",
  email: "Email",
  headline: "Headline",
  summary: "Professional summary",
  city: "City",
  availability: "Availability",
  country_code: "Country",
};

function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

function cardTitle(s: ResumeFieldSuggestionRow): string {
  switch (s.target_entity) {
    case "profile":
      return PROFILE_FIELD_LABEL[s.field_path] ?? s.field_path;
    case "experience":
      return s.target_entity_id
        ? "Update to an existing work experience"
        : "New work experience found";
    case "education":
      return s.target_entity_id
        ? "Update to an existing education entry"
        : "New education entry found";
    case "skill":
      return "New skill found";
    case "certification":
      return s.target_entity_id ? "Update to an existing certification" : "New certification found";
    case "language":
      return "New language found";
    default:
      return "Suggestion";
  }
}

/** Renders one resume_field_suggestions row with Accept / Edit / Reject actions. */
export function SuggestionCard({ suggestion }: { suggestion: ResumeFieldSuggestionRow }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function accept() {
    setError(null);
    start(async () => {
      const result = await acceptSuggestionAction(suggestion.id);
      if (!result.ok) setError(result.error ?? "Could not accept this suggestion.");
      else if (result.message) setMessage(result.message);
    });
  }

  function reject() {
    setError(null);
    start(async () => {
      const result = await rejectSuggestionAction(suggestion.id);
      if (!result.ok) setError(result.error ?? "Could not dismiss this suggestion.");
    });
  }

  function submitEdit(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await acceptSuggestionAction(suggestion.id, formData);
      if (!result.ok)
        setError(
          result.error ??
            Object.values(result.fieldErrors ?? {})[0] ??
            "Could not save this suggestion.",
        );
      else {
        setEditing(false);
        if (result.message) setMessage(result.message);
      }
    });
  }

  if (message) {
    return (
      <li className="rounded-lg border border-brand-100 bg-brand-50/40 p-3">
        <Alert tone="success">{message}</Alert>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-brand-100 bg-brand-50/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{cardTitle(suggestion)}</p>
          {suggestion.evidence_text ? (
            <p
              className="mt-0.5 truncate text-xs italic text-ink-subtle"
              title={suggestion.evidence_text}
            >
              &ldquo;{suggestion.evidence_text}&rdquo;
            </p>
          ) : null}
        </div>
        <ConfidenceBadge confidence={suggestion.confidence} />
      </div>

      {editing ? (
        <form
          action={submitEdit}
          className="mt-3 space-y-3 rounded-md border border-surface-border bg-white p-3"
        >
          <SuggestionEditFields suggestion={suggestion} />
          {error ? <p className="text-sm text-status-danger">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          {suggestion.target_entity === "profile" && suggestion.field_path === "email" ? (
            <p className="mt-1 text-xs text-ink-subtle">
              Updates your contact email on your profile — not the email you use to sign in.
            </p>
          ) : null}
          <SuggestionDiff suggestion={suggestion} />
          {error ? (
            <div className="mt-2">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={accept} disabled={pending}>
              <Check className="h-4 w-4" /> Accept
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={pending}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={reject} disabled={pending}>
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

function displayValue(
  entity: ResumeFieldSuggestionRow["target_entity"],
  fieldPath: string,
  value: unknown,
): string {
  if (value == null) return "—";
  if (entity === "profile") {
    return fieldPath === "country_code" ? countryName(String(value)) : String(value);
  }
  if (entity === "experience") {
    const v = value as ExperienceValue;
    const range = `${formatDate(v.start_date)} – ${v.is_current ? "Present" : formatDate(v.end_date)}`;
    return [v.title, v.employer_name, range].filter(Boolean).join(" · ");
  }
  if (entity === "education") {
    const v = value as EducationValue;
    return [v.institution, v.qualification].filter(Boolean).join(" · ");
  }
  if (entity === "skill") return (value as SkillValue).name;
  if (entity === "certification") {
    const v = value as CertificationValue;
    return [v.name, v.issuer].filter(Boolean).join(" · ");
  }
  if (entity === "language") {
    const v = value as LanguageValue;
    const proficiency = normalizeLanguageProficiency(v.proficiency) || v.proficiency;
    return [v.language, proficiency].filter(Boolean).join(" · ");
  }
  return String(value);
}

function SuggestionDiff({ suggestion }: { suggestion: ResumeFieldSuggestionRow }) {
  const hasCurrent = suggestion.current_value !== null && suggestion.current_value !== undefined;
  return (
    <div className="mt-2 space-y-1 text-sm">
      {hasCurrent ? (
        <p className="text-ink-subtle line-through">
          {displayValue(suggestion.target_entity, suggestion.field_path, suggestion.current_value)}
        </p>
      ) : null}
      <p className="rounded-md bg-brand-100/70 px-2 py-1 font-medium text-ink">
        {displayValue(suggestion.target_entity, suggestion.field_path, suggestion.suggested_value)}
      </p>
    </div>
  );
}

function SuggestionEditFields({ suggestion }: { suggestion: ResumeFieldSuggestionRow }) {
  if (suggestion.target_entity === "profile") {
    const value = String(suggestion.suggested_value ?? "");
    if (suggestion.field_path === "summary") {
      return (
        <Field label="Professional summary" htmlFor="value">
          <Textarea id="value" name="value" defaultValue={value} />
        </Field>
      );
    }
    if (suggestion.field_path === "country_code") {
      return (
        <Field label="Country" htmlFor="value">
          <Select id="value" name="value" defaultValue={value}>
            <option value="">Select…</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      );
    }
    if (suggestion.field_path === "email") {
      return (
        <Field
          label="Email"
          htmlFor="value"
          hint="Professional contact email — can differ from the email you use to sign in"
        >
          <Input id="value" name="value" type="email" defaultValue={value} />
        </Field>
      );
    }
    return (
      <Field
        label={PROFILE_FIELD_LABEL[suggestion.field_path] ?? suggestion.field_path}
        htmlFor="value"
      >
        <Input id="value" name="value" defaultValue={value} />
      </Field>
    );
  }

  if (suggestion.target_entity === "experience") {
    const v = suggestion.suggested_value as ExperienceValue;
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Job title" htmlFor="title" required>
            <Input id="title" name="title" defaultValue={v.title} />
          </Field>
          <Field label="Employer" htmlFor="employer_name">
            <Input id="employer_name" name="employer_name" defaultValue={v.employer_name ?? ""} />
          </Field>
          <Field label="Location" htmlFor="location">
            <Input id="location" name="location" defaultValue={v.location ?? ""} />
          </Field>
          <Field label="Start date" htmlFor="start_date">
            <Input
              id="start_date"
              name="start_date"
              type="date"
              defaultValue={v.start_date ?? ""}
            />
          </Field>
          <Field label="End date" htmlFor="end_date">
            <Input id="end_date" name="end_date" type="date" defaultValue={v.end_date ?? ""} />
          </Field>
        </div>
        <Checkbox name="is_current" label="Currently works here" defaultChecked={v.is_current} />
        <Field label="What did they do?" htmlFor="description">
          <Textarea id="description" name="description" defaultValue={v.description ?? ""} />
        </Field>
      </>
    );
  }

  if (suggestion.target_entity === "education") {
    const v = suggestion.suggested_value as EducationValue;
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Institution" htmlFor="institution" required>
            <Input id="institution" name="institution" defaultValue={v.institution} />
          </Field>
          <Field label="Qualification" htmlFor="qualification">
            <Input id="qualification" name="qualification" defaultValue={v.qualification ?? ""} />
          </Field>
          <Field label="Field of study" htmlFor="field_of_study">
            <Input
              id="field_of_study"
              name="field_of_study"
              defaultValue={v.field_of_study ?? ""}
            />
          </Field>
          <Field label="Start date" htmlFor="start_date">
            <Input
              id="start_date"
              name="start_date"
              type="date"
              defaultValue={v.start_date ?? ""}
            />
          </Field>
          <Field label="End date" htmlFor="end_date">
            <Input id="end_date" name="end_date" type="date" defaultValue={v.end_date ?? ""} />
          </Field>
        </div>
        <Checkbox name="is_current" label="Currently studying here" defaultChecked={v.is_current} />
      </>
    );
  }

  if (suggestion.target_entity === "skill") {
    const v = suggestion.suggested_value as SkillValue;
    return (
      <Field label="Skill" htmlFor="name" required>
        <Input id="name" name="name" defaultValue={v.name} />
      </Field>
    );
  }

  if (suggestion.target_entity === "certification") {
    const v = suggestion.suggested_value as CertificationValue;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Certification name" htmlFor="name" required>
          <Input id="name" name="name" defaultValue={v.name} />
        </Field>
        <Field label="Issuer" htmlFor="issuer">
          <Input id="issuer" name="issuer" defaultValue={v.issuer ?? ""} />
        </Field>
        <Field label="Issued on" htmlFor="issued_on">
          <Input id="issued_on" name="issued_on" type="date" defaultValue={v.issued_on ?? ""} />
        </Field>
      </div>
    );
  }

  if (suggestion.target_entity === "language") {
    const v = suggestion.suggested_value as LanguageValue;
    const proficiency = normalizeLanguageProficiency(v.proficiency) || v.proficiency || "";
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Language" htmlFor="language" required>
          <Input id="language" name="language" defaultValue={v.language} />
        </Field>
        <Field label="Proficiency" htmlFor="proficiency">
          <Select id="proficiency" name="proficiency" defaultValue={proficiency}>
            <option value="">Select…</option>
            {LANGUAGE_PROFICIENCIES.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    );
  }

  return null;
}
