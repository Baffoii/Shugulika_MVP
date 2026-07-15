"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { X, Plus } from "lucide-react";
import {
  addExperienceAction, addEducationAction, addSkillAction, deleteRowAction, type ActionResult,
} from "@/app/candidate/actions";
import { Field, Input, Textarea, Checkbox } from "@/components/ui/form";
import { Button, Badge } from "@/components/ui/primitives";

const initial: ActionResult = { ok: false };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : label}</Button>;
}

export function DeleteButton({ table, id }: { table: "candidate_experiences" | "candidate_education" | "candidate_skills"; id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Remove"
      disabled={pending}
      onClick={() => start(() => { void deleteRowAction(table, id); })}
      className="rounded-md p-1 text-ink-subtle hover:bg-red-50 hover:text-status-danger disabled:opacity-50"
    >
      <X className="h-4 w-4" />
    </button>
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
        <Field label="End date" htmlFor="ed-end"><Input id="ed-end" name="end_date" type="date" /></Field>
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
