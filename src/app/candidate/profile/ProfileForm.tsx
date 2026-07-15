"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateProfileAction, type ActionResult } from "@/app/candidate/actions";
import { Field, Input, Textarea, Select, Checkbox } from "@/components/ui/form";
import { Button, Alert } from "@/components/ui/primitives";
import { COUNTRIES } from "@/lib/constants";
import type { CandidateProfileRow } from "@/lib/database.types";

const initial: ActionResult = { ok: false };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}

export function ProfileForm({ profile }: { profile: CandidateProfileRow }) {
  const [state, action] = useFormState(updateProfileAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      {state.ok ? <Alert tone="success">Profile saved.</Alert> : null}
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="given_name" error={fe.given_name} required>
          <Input id="given_name" name="given_name" defaultValue={profile.given_name ?? ""} />
        </Field>
        <Field label="Last name" htmlFor="family_name" error={fe.family_name}>
          <Input id="family_name" name="family_name" defaultValue={profile.family_name ?? ""} />
        </Field>
      </div>
      <Field label="Headline" htmlFor="headline" hint="e.g. Financial Analyst · 3 years' experience" error={fe.headline}>
        <Input id="headline" name="headline" defaultValue={profile.headline ?? ""} maxLength={140} />
      </Field>
      <Field label="Professional summary" htmlFor="summary" error={fe.summary}>
        <Textarea id="summary" name="summary" defaultValue={profile.summary ?? ""} placeholder="Describe your experience and what you're looking for." />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Country" htmlFor="country_code" error={fe.country_code}>
          <Select id="country_code" name="country_code" defaultValue={profile.country_code ?? ""}>
            <option value="">Select…</option>
            {COUNTRIES.map((c) => (<option key={c.code} value={c.code}>{c.name}</option>))}
          </Select>
        </Field>
        <Field label="City" htmlFor="city" error={fe.city}>
          <Input id="city" name="city" defaultValue={profile.city ?? ""} />
        </Field>
        <Field label="Availability" htmlFor="availability" error={fe.availability}>
          <Input id="availability" name="availability" defaultValue={profile.availability ?? ""} placeholder="e.g. 1 month notice" />
        </Field>
      </div>
      <Checkbox name="open_to_work" label="I'm open to new opportunities" defaultChecked={profile.open_to_work} />
      <div className="pt-1"><SaveButton /></div>
    </form>
  );
}
