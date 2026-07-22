"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { submitJobOrderAction, type JobOrderActionResult } from "@/app/job-order-actions";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { COUNTRIES, EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, WORK_ARRANGEMENTS } from "@/lib/constants";

const initial: JobOrderActionResult = { ok: false };

function SubmitButton({ submitted }: { submitted: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending || submitted}>
      {pending ? "Submitting…" : submitted ? "Submitted" : "Submit for approval"}
    </Button>
  );
}

function JobOrderSubmissionFormInner({ onSubmitAnother }: { onSubmitAnother: () => void }) {
  const [state, action] = useFormState(submitJobOrderAction, initial);
  const [vacancies, setVacancies] = useState("1");
  const submitted = state.ok;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Submit a new job order</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={action} className="grid gap-4 md:grid-cols-2">
          {state.error ? (
            <div className="md:col-span-2">
              <Alert tone="danger">{state.error}</Alert>
            </div>
          ) : null}
          {submitted ? (
            <div className="md:col-span-2">
              <Alert tone="success">{state.message}</Alert>
            </div>
          ) : null}
          <Field label="Job title" htmlFor="title" required>
            <Input id="title" name="title" required disabled={submitted} />
          </Field>
          <Field label="Department" htmlFor="department">
            <Input id="department" name="department" disabled={submitted} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description" htmlFor="description">
              <Textarea id="description" name="description" required disabled={submitted} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Requirements" htmlFor="requirements">
              <Textarea id="requirements" name="requirements" disabled={submitted} />
            </Field>
          </div>
          <Field label="Country" htmlFor="country_code" required>
            <Select id="country_code" name="country_code" defaultValue="TZ" disabled={submitted}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code} disabled={!c.active}>
                  {c.name}
                  {!c.active ? " — not active" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" disabled={submitted} />
          </Field>
          <Field label="Employment type" htmlFor="employment_type">
            <Select id="employment_type" name="employment_type" disabled={submitted}>
              <option value="">Select</option>
              {EMPLOYMENT_TYPES.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Work arrangement" htmlFor="work_arrangement">
            <Select id="work_arrangement" name="work_arrangement" disabled={submitted}>
              <option value="">Select</option>
              {WORK_ARRANGEMENTS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Experience level" htmlFor="experience_level">
            <Select id="experience_level" name="experience_level" disabled={submitted}>
              <option value="">Select</option>
              {EXPERIENCE_LEVELS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vacancies" htmlFor="vacancy_count" required>
            <Input
              id="vacancy_count"
              name="vacancy_count"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={vacancies}
              required
              disabled={submitted}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setVacancies("");
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                setVacancies(String(Math.max(1, Math.trunc(n))));
              }}
              onBlur={() => {
                const n = Number(vacancies);
                if (!Number.isFinite(n) || n < 1) setVacancies("1");
              }}
            />
          </Field>
          <Field label="Recruitment route" htmlFor="recruitment_path" required>
            <Select
              id="recruitment_path"
              name="recruitment_path"
              defaultValue="B"
              disabled={submitted}
            >
              <option value="B">Shugulika-managed</option>
              <option value="A">Direct employer recruitment</option>
            </Select>
          </Field>
          <Field label="Application deadline" htmlFor="application_deadline">
            <Input
              id="application_deadline"
              name="application_deadline"
              type="date"
              disabled={submitted}
            />
          </Field>
          <Field label="Minimum salary" htmlFor="salary_min">
            <Input id="salary_min" name="salary_min" type="number" min="0" disabled={submitted} />
          </Field>
          <Field label="Maximum salary" htmlFor="salary_max">
            <Input id="salary_max" name="salary_max" type="number" min="0" disabled={submitted} />
          </Field>
          <div className="flex items-end">
            <Checkbox
              name="salary_public"
              label="Show salary on the public job post"
              disabled={submitted}
            />
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-3">
            {submitted ? (
              <Button type="button" variant="secondary" onClick={onSubmitAnother}>
                Submit another role
              </Button>
            ) : null}
            <SubmitButton submitted={submitted} />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function JobOrderSubmissionForm() {
  const [formKey, setFormKey] = useState(0);
  return (
    <JobOrderSubmissionFormInner
      key={formKey}
      onSubmitAnother={() => setFormKey((key) => key + 1)}
    />
  );
}
