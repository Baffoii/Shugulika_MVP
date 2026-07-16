"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Pencil, Plus, X } from "lucide-react";
import {
  addExperienceAction,
  addEducationAction,
  addSkillAction,
  deleteRowAction,
  updateEducationAction,
  updateExperienceAction,
  type ActionResult,
} from "@/app/candidate/actions";
import { Field, Input, Textarea, Checkbox } from "@/components/ui/form";
import { Button, Badge } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import type { CandidateEducationRow, CandidateExperienceRow } from "@/lib/database.types";

const initial: ActionResult = { ok: false };

function IconTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-white opacity-0 shadow-pop transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : label}</Button>;
}

export function DeleteButton({ table, id }: { table: "candidate_experiences" | "candidate_education" | "candidate_skills"; id: string }) {
  const [pending, start] = useTransition();
  const label = table === "candidate_experiences"
    ? "Delete experience"
    : table === "candidate_education"
      ? "Delete education"
      : "Delete skill";
  return (
    <IconTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={pending}
        onClick={() => start(() => { void deleteRowAction(table, id); })}
        className="rounded-md p-1 text-ink-subtle hover:bg-red-50 hover:text-status-danger disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </IconTooltip>
  );
}

export function ExperienceItem({ experience }: { experience: CandidateExperienceRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-lg border border-surface-border p-3">
        <ExperienceEditForm experience={experience} onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-surface-border p-3">
      <div>
        <p className="text-sm font-medium text-ink">
          {experience.title}{experience.employer_name ? ` · ${experience.employer_name}` : ""}
        </p>
        <p className="text-xs text-ink-subtle">
          {formatDate(experience.start_date)} – {experience.is_current ? "Present" : formatDate(experience.end_date)}
        </p>
        {experience.description ? <p className="mt-1 text-sm text-ink-muted">{experience.description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconTooltip label="Edit experience">
          <button
            type="button"
            aria-label="Edit experience"
            onClick={() => setEditing(true)}
            className="rounded-md p-1 text-ink-subtle hover:bg-brand-50 hover:text-brand-700"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </IconTooltip>
        <DeleteButton table="candidate_experiences" id={experience.id} />
      </div>
    </li>
  );
}

function ExperienceEditForm({ experience, onCancel }: { experience: CandidateExperienceRow; onCancel: () => void }) {
  const updateAction = updateExperienceAction.bind(null, experience.id);
  const [state, action] = useFormState(updateAction, initial);
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) onCancel();
  }, [state.ok, onCancel]);

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title" htmlFor={`ex-title-${experience.id}`} error={fe.title} required>
          <Input id={`ex-title-${experience.id}`} name="title" defaultValue={experience.title} />
        </Field>
        <Field label="Employer" htmlFor={`ex-emp-${experience.id}`} error={fe.employer_name}>
          <Input id={`ex-emp-${experience.id}`} name="employer_name" defaultValue={experience.employer_name ?? ""} />
        </Field>
        <Field label="Location" htmlFor={`ex-location-${experience.id}`} error={fe.location}>
          <Input id={`ex-location-${experience.id}`} name="location" defaultValue={experience.location ?? ""} />
        </Field>
        <Field label="Start date" htmlFor={`ex-start-${experience.id}`} error={fe.start_date}>
          <Input id={`ex-start-${experience.id}`} name="start_date" type="date" defaultValue={experience.start_date ?? ""} />
        </Field>
        <Field label="End date" htmlFor={`ex-end-${experience.id}`} error={fe.end_date}>
          <Input id={`ex-end-${experience.id}`} name="end_date" type="date" defaultValue={experience.end_date ?? ""} />
        </Field>
      </div>
      <Checkbox name="is_current" label="I currently work here" defaultChecked={experience.is_current} />
      <Field label="What did you do?" htmlFor={`ex-desc-${experience.id}`} error={fe.description}>
        <Textarea id={`ex-desc-${experience.id}`} name="description" defaultValue={experience.description ?? ""} />
      </Field>
      {state.error ? <p className="text-sm text-status-danger">{state.error}</p> : null}
      <div className="flex gap-2">
        <SubmitButton label="Save changes" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function EducationItem({ education }: { education: CandidateEducationRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-lg border border-surface-border p-3">
        <EducationEditForm education={education} onCancel={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-surface-border p-3">
      <div>
        <p className="text-sm font-medium text-ink">{education.institution}</p>
        <p className="text-xs text-ink-subtle">
          {[education.qualification, education.field_of_study].filter(Boolean).join(" · ")}
        </p>
        <p className="text-xs text-ink-subtle">
          {formatDate(education.start_date)} – {education.is_current ? "Present" : formatDate(education.end_date)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconTooltip label="Edit education">
          <button
            type="button"
            aria-label="Edit education"
            onClick={() => setEditing(true)}
            className="rounded-md p-1 text-ink-subtle hover:bg-brand-50 hover:text-brand-700"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </IconTooltip>
        <DeleteButton table="candidate_education" id={education.id} />
      </div>
    </li>
  );
}

function EducationEditForm({ education, onCancel }: { education: CandidateEducationRow; onCancel: () => void }) {
  const updateAction = updateEducationAction.bind(null, education.id);
  const [state, action] = useFormState(updateAction, initial);
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    if (state.ok) onCancel();
  }, [state.ok, onCancel]);

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Institution" htmlFor={`ed-inst-${education.id}`} error={fe.institution} required>
          <Input id={`ed-inst-${education.id}`} name="institution" defaultValue={education.institution} />
        </Field>
        <Field label="Qualification" htmlFor={`ed-qual-${education.id}`} error={fe.qualification}>
          <Input id={`ed-qual-${education.id}`} name="qualification" defaultValue={education.qualification ?? ""} />
        </Field>
        <Field label="Field of study" htmlFor={`ed-field-${education.id}`} error={fe.field_of_study}>
          <Input id={`ed-field-${education.id}`} name="field_of_study" defaultValue={education.field_of_study ?? ""} />
        </Field>
        <Field label="Start date" htmlFor={`ed-start-${education.id}`} error={fe.start_date}>
          <Input id={`ed-start-${education.id}`} name="start_date" type="date" defaultValue={education.start_date ?? ""} />
        </Field>
        <Field label="End date" htmlFor={`ed-end-${education.id}`} error={fe.end_date}>
          <Input id={`ed-end-${education.id}`} name="end_date" type="date" defaultValue={education.end_date ?? ""} />
        </Field>
      </div>
      <Checkbox name="is_current" label="I'm currently studying here" defaultChecked={education.is_current} />
      {state.error ? <p className="text-sm text-status-danger">{state.error}</p> : null}
      <div className="flex gap-2">
        <SubmitButton label="Save changes" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function ExperienceAddForm() {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(addExperienceAction, initial);
  const fe = state.fieldErrors ?? {};
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add experience</Button>;
  return (
    <form action={action} className="space-y-3 rounded-lg border border-surface-border bg-surface-muted p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title" htmlFor="ex-title" error={fe.title} required><Input id="ex-title" name="title" /></Field>
        <Field label="Employer" htmlFor="ex-emp" error={fe.employer_name}><Input id="ex-emp" name="employer_name" /></Field>
        <Field label="Start date" htmlFor="ex-start"><Input id="ex-start" name="start_date" type="date" /></Field>
        <Field label="End date" htmlFor="ex-end"><Input id="ex-end" name="end_date" type="date" /></Field>
      </div>
      <Checkbox name="is_current" label="I currently work here" />
      <Field label="What did you do?" htmlFor="ex-desc"><Textarea id="ex-desc" name="description" /></Field>
      <div className="flex gap-2"><SubmitButton label="Add experience" /><Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function EducationAddForm() {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(addEducationAction, initial);
  const fe = state.fieldErrors ?? {};
  if (!open) return <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add education</Button>;
  return (
    <form action={action} className="space-y-3 rounded-lg border border-surface-border bg-surface-muted p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Institution" htmlFor="ed-inst" error={fe.institution} required><Input id="ed-inst" name="institution" /></Field>
        <Field label="Qualification" htmlFor="ed-qual"><Input id="ed-qual" name="qualification" placeholder="e.g. Bachelor of Commerce" /></Field>
        <Field label="Field of study" htmlFor="ed-field"><Input id="ed-field" name="field_of_study" /></Field>
        <Field label="Start date" htmlFor="ed-start" error={fe.start_date}><Input id="ed-start" name="start_date" type="date" /></Field>
        <Field label="End date" htmlFor="ed-end" error={fe.end_date}><Input id="ed-end" name="end_date" type="date" /></Field>
      </div>
      <Checkbox name="is_current" label="I'm currently studying here" />
      <div className="flex gap-2"><SubmitButton label="Add education" /><Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function SkillAdder({ skills }: { skills: { id: string; name: string }[] }) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {skills.length === 0 ? <p className="text-sm text-ink-subtle">No skills added yet.</p> : null}
        {skills.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <Badge tone="neutral">{s.name}</Badge>
            <DeleteButton table="candidate_skills" id={s.id} />
          </span>
        ))}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          start(() => { void addSkillAction(value); });
          setValue("");
        }}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add a skill and press Enter" />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !value.trim()}>Add</Button>
      </form>
    </div>
  );
}
