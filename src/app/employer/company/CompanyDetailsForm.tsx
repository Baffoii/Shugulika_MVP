"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { COMPANY_SIZES } from "@/lib/constants";
import type { OrganizationRow } from "@/lib/database.types";
import { updateEmployerCompanyAction, type CompanyUpdateResult } from "./actions";

const initial: CompanyUpdateResult = { ok: false };

function SaveButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>;
}

export function CompanyDetailsForm({ org }: { org: OrganizationRow }) {
  const [state, formAction] = useFormState(updateEmployerCompanyAction, initial);
  const errors = state.fieldErrors ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company details</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={formAction} className="space-y-4">
          {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
          {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Trading name" hint="Shown to candidates" error={errors.trading_name}>
              <Input name="trading_name" defaultValue={org.trading_name ?? ""} maxLength={200} />
            </Field>
            <Field label="Website" error={errors.website}>
              <Input
                name="website"
                type="url"
                placeholder="https://example.com"
                defaultValue={org.website ?? ""}
                maxLength={300}
              />
            </Field>
            <Field label="Industry" error={errors.industry}>
              <Input name="industry" defaultValue={org.industry ?? ""} maxLength={120} />
            </Field>
            <Field label="Company size" error={errors.company_size}>
              <Select name="company_size" defaultValue={org.company_size ?? ""}>
                <option value="">Select…</option>
                {COMPANY_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} employees
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Region / state" error={errors.region}>
              <Input name="region" defaultValue={org.region ?? ""} maxLength={120} />
            </Field>
            <Field label="City" error={errors.city}>
              <Input name="city" defaultValue={org.city ?? ""} maxLength={120} />
            </Field>
          </div>
          <Field label="Physical address" error={errors.physical_address}>
            <Textarea
              name="physical_address"
              rows={2}
              defaultValue={org.physical_address ?? ""}
              maxLength={400}
            />
          </Field>
          <Field label="Postal address" hint="Optional" error={errors.postal_address}>
            <Textarea
              name="postal_address"
              rows={2}
              defaultValue={org.postal_address ?? ""}
              maxLength={400}
            />
          </Field>
          <SaveButton />
        </form>
      </CardBody>
    </Card>
  );
}
