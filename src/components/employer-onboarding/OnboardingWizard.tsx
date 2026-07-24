"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  saveEmployerOnboardingSectionAction,
  submitEmployerApplicationAction,
  type OnboardingActionResult,
} from "@/app/onboarding/employer/actions";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { COUNTRIES, COMPANY_SIZES, ORGANIZATION_TYPES } from "@/lib/constants";
import {
  applicationReadyToSubmit,
  type OnboardingStepKey,
  type RequestedChangeItem,
} from "@/lib/employer-onboarding";
import type { EligibleFranchiseRow, EmployerApplicationRow } from "@/lib/database.types";

const initial: OnboardingActionResult = { ok: false };

/** useFormState can briefly yield undefined while a redirecting server action settles. */
function formState(state: OnboardingActionResult | undefined): OnboardingActionResult {
  return state ?? initial;
}

export type WizardStep = OnboardingStepKey | "review";

interface SectionProps {
  app: EmployerApplicationRow | null;
  guidance: RequestedChangeItem[];
}

function FieldGuidance({ field, guidance }: { field: string; guidance: RequestedChangeItem[] }) {
  const items = guidance.filter((g) => g.field === field);
  if (items.length === 0) return null;
  return (
    <div className="mt-1 space-y-1">
      {items.map((g, i) => (
        <p key={i} className="text-xs font-medium text-amber-700">
          Reviewer: {g.instruction}
        </p>
      ))}
    </div>
  );
}

function SaveButton({ label = "Save & continue" }: { label?: string }) {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Saving…" : label}</Button>;
}

function SectionShell({
  title,
  description,
  step,
  state,
  action,
  children,
}: {
  title: string;
  description: string;
  step: OnboardingStepKey;
  state: OnboardingActionResult;
  action: (formData: FormData) => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-0.5 text-xs text-ink-subtle">{description}</p>
        </div>
      </CardHeader>
      <CardBody>
        <form action={action} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="step" value={step} />
          {state.error ? (
            <div className="md:col-span-2">
              <Alert tone="danger">{state.error}</Alert>
            </div>
          ) : null}
          {children}
          <div className="md:col-span-2 flex justify-end">
            <SaveButton />
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function CompanySection({ app, guidance }: SectionProps) {
  const [raw, action] = useFormState(saveEmployerOnboardingSectionAction, initial);
  const state = formState(raw);
  const err = state.fieldErrors ?? {};
  return (
    <SectionShell
      title="Company identity"
      description="No tax ID or registration number is needed in this version."
      step="company"
      state={state}
      action={action}
    >
      <Field label="Registered company name" htmlFor="legal_name" required error={err.legal_name}>
        <Input id="legal_name" name="legal_name" defaultValue={app?.legal_name ?? ""} required />
        <FieldGuidance field="legal_name" guidance={guidance} />
      </Field>
      <Field
        label="Trading name (if different)"
        htmlFor="trading_name"
        error={err.trading_name}
      >
        <Input id="trading_name" name="trading_name" defaultValue={app?.trading_name ?? ""} />
        <FieldGuidance field="trading_name" guidance={guidance} />
      </Field>
      <Field
        label="Organization type"
        htmlFor="organization_type"
        required
        error={err.organization_type}
      >
        <Select
          id="organization_type"
          name="organization_type"
          defaultValue={app?.organization_type ?? ""}
          required
        >
          <option value="">Select</option>
          {ORGANIZATION_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
        <FieldGuidance field="organization_type" guidance={guidance} />
      </Field>
      <Field label="Industry" htmlFor="industry" required error={err.industry}>
        <Input id="industry" name="industry" defaultValue={app?.industry ?? ""} required />
        <FieldGuidance field="industry" guidance={guidance} />
      </Field>
      <Field label="Company size" htmlFor="company_size" required error={err.company_size}>
        <Select id="company_size" name="company_size" defaultValue={app?.company_size ?? ""} required>
          <option value="">Select</option>
          {COMPANY_SIZES.map((s) => (
            <option key={s} value={s}>
              {s} employees
            </option>
          ))}
        </Select>
        <FieldGuidance field="company_size" guidance={guidance} />
      </Field>
      <Field label="Year established" htmlFor="year_established" error={err.year_established}>
        <Input
          id="year_established"
          name="year_established"
          type="number"
          min={1800}
          max={2100}
          defaultValue={app?.year_established ?? ""}
        />
        <FieldGuidance field="year_established" guidance={guidance} />
      </Field>
      <div className="md:col-span-2">
        <Field label="Company website" htmlFor="website" error={err.website} hint="https://…">
          <Input
            id="website"
            name="website"
            type="url"
            placeholder="https://example.com"
            defaultValue={app?.website ?? ""}
          />
          <FieldGuidance field="website" guidance={guidance} />
        </Field>
      </div>
    </SectionShell>
  );
}

export function AddressSection({ app, guidance }: SectionProps) {
  const [raw, action] = useFormState(saveEmployerOnboardingSectionAction, initial);
  const state = formState(raw);
  const err = state.fieldErrors ?? {};
  return (
    <SectionShell
      title="Registered address"
      description="This geography determines the responsible Shugulika office."
      step="address"
      state={state}
      action={action}
    >
      <Field label="Country" htmlFor="country_code" required error={err.country_code}>
        <Select id="country_code" name="country_code" defaultValue={app?.country_code ?? "TZ"} required>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} disabled={!c.active}>
              {c.name}
              {!c.active ? " — not supported yet" : ""}
            </option>
          ))}
        </Select>
        <FieldGuidance field="country_code" guidance={guidance} />
      </Field>
      <Field label="Region / state / province" htmlFor="region" required error={err.region}>
        <Input id="region" name="region" defaultValue={app?.region ?? ""} required />
        <FieldGuidance field="region" guidance={guidance} />
      </Field>
      <Field label="City" htmlFor="city" required error={err.city}>
        <Input id="city" name="city" defaultValue={app?.city ?? ""} required />
        <FieldGuidance field="city" guidance={guidance} />
      </Field>
      <Field label="Physical address" htmlFor="physical_address" required error={err.physical_address}>
        <Input
          id="physical_address"
          name="physical_address"
          defaultValue={app?.physical_address ?? ""}
          required
        />
        <FieldGuidance field="physical_address" guidance={guidance} />
      </Field>
      <div className="md:col-span-2">
        <Field label="Postal address (if applicable)" htmlFor="postal_address" error={err.postal_address}>
          <Input id="postal_address" name="postal_address" defaultValue={app?.postal_address ?? ""} />
          <FieldGuidance field="postal_address" guidance={guidance} />
        </Field>
      </div>
    </SectionShell>
  );
}

export function ContactSection({ app, guidance }: SectionProps) {
  const [raw, action] = useFormState(saveEmployerOnboardingSectionAction, initial);
  const state = formState(raw);
  const err = state.fieldErrors ?? {};
  return (
    <SectionShell
      title="Primary contact"
      description="Defaults to your account details — this person administers the employer account."
      step="contact"
      state={state}
      action={action}
    >
      <Field label="Full name" htmlFor="contact_name" required error={err.contact_name}>
        <Input id="contact_name" name="contact_name" defaultValue={app?.contact_name ?? ""} required />
        <FieldGuidance field="contact_name" guidance={guidance} />
      </Field>
      <Field label="Job title" htmlFor="contact_job_title" required error={err.contact_job_title}>
        <Input
          id="contact_job_title"
          name="contact_job_title"
          defaultValue={app?.contact_job_title ?? ""}
          required
        />
        <FieldGuidance field="contact_job_title" guidance={guidance} />
      </Field>
      <Field label="Work email" htmlFor="contact_email" required error={err.contact_email}>
        <Input
          id="contact_email"
          name="contact_email"
          type="email"
          defaultValue={app?.contact_email ?? ""}
          required
        />
        <FieldGuidance field="contact_email" guidance={guidance} />
      </Field>
      <Field label="Phone number" htmlFor="contact_phone" required error={err.contact_phone}>
        <Input id="contact_phone" name="contact_phone" defaultValue={app?.contact_phone ?? ""} required />
        <FieldGuidance field="contact_phone" guidance={guidance} />
      </Field>
      <div className="md:col-span-2 space-y-1">
        <Checkbox
          name="contact_is_authorized"
          label="I confirm this person is authorized to administer the employer account."
          defaultChecked={app?.contact_is_authorized ?? false}
        />
        {err.contact_is_authorized ? (
          <p className="text-xs font-medium text-status-danger">{err.contact_is_authorized}</p>
        ) : null}
      </div>
    </SectionShell>
  );
}

export function RoutingSection({
  app,
  guidance,
  franchises,
}: SectionProps & { franchises: EligibleFranchiseRow[] }) {
  const [raw, action] = useFormState(saveEmployerOnboardingSectionAction, initial);
  const state = formState(raw);
  const err = state.fieldErrors ?? {};
  const hasGeography = !!app?.country_code && !!app?.region;
  return (
    <SectionShell
      title="Shugulika office"
      description="Based on your registered country and region."
      step="routing"
      state={state}
      action={action}
    >
      <div className="md:col-span-2 space-y-3">
        {!hasGeography ? (
          <Alert tone="warn">
            Complete the <Link href="?step=address" className="font-medium underline">registered
            address</Link> first so we can propose an eligible office.
          </Alert>
        ) : franchises.length === 0 ? (
          <Alert tone="info">
            No Shugulika office currently covers {app?.region}, {app?.country_code}. Your
            application will go to the Shugulika HQ approval queue.
          </Alert>
        ) : (
          <Alert tone="info">
            {franchises.length === 1
              ? `Proposed office for your geography: ${franchises[0]?.name}.`
              : `${franchises.length} offices are eligible for your geography — choose one below or let HQ assign.`}
          </Alert>
        )}
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="radio"
            name="routing_mode"
            value="auto"
            defaultChecked={(app?.routing_mode ?? "auto") === "auto"}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Propose automatically</span>
            <span className="block text-xs text-ink-subtle">
              The single eligible office is preselected; with no eligible office the application
              goes to HQ.
            </span>
          </span>
        </label>
        {franchises.length > 0 ? (
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="radio"
                name="routing_mode"
                value="franchise"
                defaultChecked={app?.routing_mode === "franchise"}
                className="mt-1"
              />
              <span className="font-medium">Choose an eligible office</span>
            </label>
            <div className="pl-6">
              <Select
                name="requested_franchise_id"
                defaultValue={app?.requested_franchise_id ?? ""}
                aria-label="Eligible Shugulika offices"
              >
                <option value="">Select an office</option>
                {franchises.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
              {err.requested_franchise_id ? (
                <p className="mt-1 text-xs font-medium text-status-danger">
                  {err.requested_franchise_id}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="radio"
            name="routing_mode"
            value="hq"
            defaultChecked={app?.routing_mode === "hq"}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Let Shugulika HQ assign my office</span>
            <span className="block text-xs text-ink-subtle">
              No franchise sees your application until HQ assigns it.
            </span>
          </span>
        </label>
        <FieldGuidance field="routing" guidance={guidance} />
      </div>
    </SectionShell>
  );
}

export function DeclarationsSection({ app }: SectionProps) {
  const [raw, action] = useFormState(saveEmployerOnboardingSectionAction, initial);
  const state = formState(raw);
  const err = state.fieldErrors ?? {};
  return (
    <SectionShell
      title="Declarations"
      description="Required before your application can be reviewed."
      step="declarations"
      state={state}
      action={action}
    >
      <div className="md:col-span-2 space-y-3">
        <div className="space-y-1">
          <Checkbox
            name="declared_accurate"
            label="I confirm the submitted information is accurate."
            defaultChecked={app?.declared_accurate ?? false}
          />
          {err.declared_accurate ? (
            <p className="text-xs font-medium text-status-danger">{err.declared_accurate}</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Checkbox
            name="declared_authorized"
            label="I confirm I am authorized to represent this company."
            defaultChecked={app?.declared_authorized ?? false}
          />
          {err.declared_authorized ? (
            <p className="text-xs font-medium text-status-danger">{err.declared_authorized}</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <Checkbox
            name="accepted_terms"
            label="I accept the employer terms and the privacy terms."
            defaultChecked={app?.accepted_terms ?? false}
          />
          {err.accepted_terms ? (
            <p className="text-xs font-medium text-status-danger">{err.accepted_terms}</p>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// Review & submit
// ---------------------------------------------------------------------------
function SubmitApplicationButton({ isResubmission }: { isResubmission: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending}>
      {pending
        ? "Submitting…"
        : isResubmission
          ? "Resubmit for review"
          : "Submit application for review"}
    </Button>
  );
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="text-right font-medium text-ink">{value || "—"}</dd>
    </div>
  );
}

export function ReviewScreen({
  app,
  franchises,
}: {
  app: EmployerApplicationRow;
  franchises: EligibleFranchiseRow[];
}) {
  const [raw, action] = useFormState(submitEmployerApplicationAction, initial);
  const state = formState(raw);
  const ready = applicationReadyToSubmit(app);
  const isResubmission = app.status === "changes_requested";
  const orgType = ORGANIZATION_TYPES.find((t) => t.key === app.organization_type)?.label;
  const country = COUNTRIES.find((c) => c.code === app.country_code)?.name ?? app.country_code;

  const routingLabel =
    app.routing_mode === "hq"
      ? "Shugulika HQ will assign my office"
      : app.routing_mode === "franchise"
        ? (franchises.find((f) => f.id === app.requested_franchise_id)?.name ??
          "Selected office (pending eligibility check)")
        : franchises.length === 1
          ? `${franchises[0]?.name} (proposed automatically)`
          : franchises.length === 0
            ? "Shugulika HQ approval queue (no eligible office)"
            : "Choose an office or HQ assignment before submitting";

  const sections: { title: string; step: WizardStep; rows: [string, React.ReactNode][] }[] = [
    {
      title: "Company identity",
      step: "company",
      rows: [
        ["Registered name", app.legal_name],
        ["Trading name", app.trading_name],
        ["Organization type", orgType ?? app.organization_type],
        ["Industry", app.industry],
        ["Company size", app.company_size],
        ["Year established", app.year_established],
        ["Website", app.website],
      ],
    },
    {
      title: "Registered address",
      step: "address",
      rows: [
        ["Country", country],
        ["Region", app.region],
        ["City", app.city],
        ["Physical address", app.physical_address],
        ["Postal address", app.postal_address],
      ],
    },
    {
      title: "Primary contact",
      step: "contact",
      rows: [
        ["Name", app.contact_name],
        ["Job title", app.contact_job_title],
        ["Work email", app.contact_email],
        ["Phone", app.contact_phone],
        ["Authorized to administer", app.contact_is_authorized ? "Yes" : "No"],
      ],
    },
    {
      title: "Shugulika office",
      step: "routing",
      rows: [["Routing", routingLabel]],
    },
    {
      title: "Declarations",
      step: "declarations",
      rows: [
        ["Information accurate", app.declared_accurate ? "Confirmed" : "Not confirmed"],
        ["Authorized to represent", app.declared_authorized ? "Confirmed" : "Not confirmed"],
        ["Terms accepted", app.accepted_terms ? "Accepted" : "Not accepted"],
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <Card key={section.title}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <Link
              href={`?step=${section.step}`}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              Edit
            </Link>
          </CardHeader>
          <CardBody>
            <dl className="divide-y divide-surface-border/60">
              {section.rows.map(([label, value]) => (
                <ReviewRow key={label} label={label} value={value} />
              ))}
            </dl>
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardBody>
          <form action={action} className="space-y-3">
            <input type="hidden" name="application_id" value={app.id} />
            {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
            {!ready ? (
              <Alert tone="warn">
                Some required information is missing — open the sections marked above and complete
                them before submitting.
              </Alert>
            ) : (
              <p className="text-sm text-ink-muted">
                After submission your application becomes read-only unless a reviewer requests
                changes.
              </p>
            )}
            <div className="flex justify-end">
              <SubmitApplicationButton isResubmission={isResubmission} />
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
