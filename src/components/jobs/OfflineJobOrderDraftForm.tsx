"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createOfflineJobOrderDraftAction,
  type JobOrderActionResult,
} from "@/app/job-order-actions";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { COUNTRIES } from "@/lib/constants";

const initial: JobOrderActionResult = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Creating…" : "Create offline draft"}</Button>;
}

export function OfflineJobOrderDraftForm({
  employers,
}: {
  employers: Array<{ id: string; name: string }>;
}) {
  const [state, action] = useActionState(createOfflineJobOrderDraftAction, initial);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Create offline job draft</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={action} className="grid gap-4 md:grid-cols-2">
          {state.error ? (
            <div className="md:col-span-2">
              <Alert tone="danger">{state.error}</Alert>
            </div>
          ) : null}
          {state.ok ? (
            <div className="md:col-span-2">
              <Alert tone="success">{state.message}</Alert>
            </div>
          ) : null}
          <Field label="Employer" htmlFor="employer_org_id" required>
            <Select id="employer_org_id" name="employer_org_id" required defaultValue="">
              <option value="" disabled>
                Select employer
              </option>
              {employers.map((employer) => (
                <option key={employer.id} value={employer.id}>
                  {employer.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Job title" htmlFor="offline_title" required>
            <Input id="offline_title" name="title" required />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description" htmlFor="offline_description">
              <Textarea id="offline_description" name="description" />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Requirements" htmlFor="offline_requirements">
              <Textarea id="offline_requirements" name="requirements" />
            </Field>
          </div>
          <Field label="Country" htmlFor="offline_country_code" required>
            <Select id="offline_country_code" name="country_code" defaultValue="TZ">
              {COUNTRIES.map((country) => (
                <option key={country.code} value={country.code} disabled={!country.active}>
                  {country.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City" htmlFor="offline_city">
            <Input id="offline_city" name="city" />
          </Field>
          <Field label="Vacancies" htmlFor="offline_vacancy_count">
            <Input
              id="offline_vacancy_count"
              name="vacancy_count"
              type="number"
              min={1}
              defaultValue={1}
            />
          </Field>
          <Field label="Recruitment path" htmlFor="offline_recruitment_path">
            <Select id="offline_recruitment_path" name="recruitment_path" defaultValue="B">
              <option value="B">Path B — managed</option>
              <option value="A">Path A — direct</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <SubmitButton />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
