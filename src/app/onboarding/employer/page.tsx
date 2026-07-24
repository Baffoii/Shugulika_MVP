import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAccountMenu } from "@/components/layout/UserAccountMenu";
import {
  Alert,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import {
  AddressSection,
  CompanySection,
  ContactSection,
  DeclarationsSection,
  ReviewScreen,
  RoutingSection,
  type WizardStep,
} from "@/components/employer-onboarding/OnboardingWizard";
import {
  StartRevisionButton,
  WithdrawApplicationButton,
} from "@/components/employer-onboarding/StatusActions";
import { getApprovedEmployerOrg, requireSession } from "@/lib/auth";
import {
  getEligibleFranchises,
  getEmployerApplicationEvents,
  getMyEmployerApplication,
} from "@/lib/data/employer-applications";
import {
  ONBOARDING_STEPS,
  applicationStatusDescription,
  applicationStatusLabel,
  canEditApplication,
  canWithdrawApplication,
  firstIncompleteStep,
  parseRequestedChanges,
  stepComplete,
  type OnboardingStepKey,
} from "@/lib/employer-onboarding";
import { formatDateTime } from "@/lib/format";
import { EMPLOYER_REJECTION_CATEGORIES } from "@/lib/constants";

export const metadata: Metadata = { title: "Employer registration" };

const WIZARD_STEPS: WizardStep[] = [...ONBOARDING_STEPS.map((s) => s.key), "review"];

function resolveStep(
  requested: string | undefined,
  appStatus: string | null,
  incomplete: OnboardingStepKey | null,
): WizardStep {
  if (requested && WIZARD_STEPS.includes(requested as WizardStep)) {
    return requested as WizardStep;
  }
  if (appStatus === "changes_requested") return "review";
  return incomplete ?? "company";
}

export default async function EmployerOnboardingPage({
  searchParams,
}: {
  searchParams: { step?: string };
}) {
  const ctx = await requireSession();
  const isEmployer = ctx.memberships.some(
    (m) => m.status === "active" && m.role === "employer_user",
  );
  if (!isEmployer) redirect("/unauthorized");
  if (await getApprovedEmployerOrg(ctx)) redirect("/employer/dashboard");

  const app = await getMyEmployerApplication(ctx.userId);
  const editable = !app || canEditApplication(app.status);
  const guidance = app ? parseRequestedChanges(app.requested_changes) : [];
  const incomplete = app ? firstIncompleteStep(app) : "company";
  const step = editable ? resolveStep(searchParams.step, app?.status ?? null, incomplete) : null;

  const franchises = app?.country_code
    ? await getEligibleFranchises(app.country_code, app.region)
    : [];
  const events = app ? await getEmployerApplicationEvents(app.id) : [];

  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <div className="border-b border-surface-border bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <UserAccountMenu userName={ctx.profile?.full_name ?? ctx.email} email={ctx.email} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-ink">Register your company</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Complete your company registration so Shugulika can review and unlock the employer
            portal.
          </p>
        </div>

        {app && !editable ? (
          <StatusPanel app={app} events={events} />
        ) : (
          <>
            {app?.status === "changes_requested" ? (
              <div className="mb-4 space-y-3">
                <Alert tone="warn" title="Changes requested">
                  {app.changes_requested_message ||
                    "A reviewer asked you to update your application before it can be approved."}
                </Alert>
                {guidance.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>What to update</CardTitle>
                    </CardHeader>
                    <CardBody>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
                        {guidance.map((g, i) => (
                          <li key={i}>
                            {g.field ? <span className="font-medium">{g.field}: </span> : null}
                            {g.instruction}
                          </li>
                        ))}
                      </ul>
                    </CardBody>
                  </Card>
                ) : null}
              </div>
            ) : null}

            <StepNav current={step!} app={app} />

            <div className="mt-4">
              {step === "company" ? <CompanySection app={app} guidance={guidance} /> : null}
              {step === "address" ? <AddressSection app={app} guidance={guidance} /> : null}
              {step === "contact" ? <ContactSection app={app} guidance={guidance} /> : null}
              {step === "routing" ? (
                <RoutingSection app={app} guidance={guidance} franchises={franchises} />
              ) : null}
              {step === "declarations" ? (
                <DeclarationsSection app={app} guidance={guidance} />
              ) : null}
              {step === "review" ? (
                app ? (
                  <ReviewScreen app={app} franchises={franchises} />
                ) : (
                  <Alert tone="warn">
                    Save at least the company identity section before reviewing.
                  </Alert>
                )
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepNav({
  current,
  app,
}: {
  current: WizardStep;
  app: Awaited<ReturnType<typeof getMyEmployerApplication>>;
}) {
  const items: { key: WizardStep; label: string }[] = [
    ...ONBOARDING_STEPS.map((s) => ({ key: s.key as WizardStep, label: s.label })),
    { key: "review", label: "Review" },
  ];

  return (
    <nav aria-label="Registration steps" className="overflow-x-auto">
      <ol className="flex min-w-max gap-1 sm:gap-2">
        {items.map((item, index) => {
          const done =
            item.key === "review"
              ? !!app && firstIncompleteStep(app) === null
              : !!app && stepComplete(app, item.key as OnboardingStepKey);
          const active = item.key === current;
          return (
            <li key={item.key}>
              <Link
                href={`?step=${item.key}`}
                className={[
                  "inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                  active
                    ? "bg-brand-500 text-white"
                    : done
                      ? "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "bg-white text-ink-muted ring-1 ring-surface-border hover:bg-surface-muted",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                    active ? "bg-white/20 text-white" : "bg-surface-muted text-ink-subtle",
                  ].join(" ")}
                >
                  {index + 1}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StatusPanel({
  app,
  events,
}: {
  app: NonNullable<Awaited<ReturnType<typeof getMyEmployerApplication>>>;
  events: Awaited<ReturnType<typeof getEmployerApplicationEvents>>;
}) {
  const rejectionLabel = EMPLOYER_REJECTION_CATEGORIES.find(
    (c) => c.key === app.rejection_category,
  )?.label;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={app.status} label={applicationStatusLabel(app.status)} />
            {app.legal_name ? (
              <p className="text-sm font-medium text-ink">{app.legal_name}</p>
            ) : null}
          </div>
          <p className="text-sm text-ink-muted">{applicationStatusDescription(app)}</p>

          {app.status === "rejected" && (rejectionLabel || app.rejection_reason) ? (
            <Alert tone="danger" title={rejectionLabel ?? "Not approved"}>
              {app.rejection_reason}
            </Alert>
          ) : null}

          {app.status === "approved" ? (
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/employer/dashboard" size="sm">
                Open employer dashboard
              </ButtonLink>
            </div>
          ) : null}

          {canWithdrawApplication(app.status) ? (
            <WithdrawApplicationButton applicationId={app.id} />
          ) : null}

          {app.status === "withdrawn" || (app.status === "rejected" && app.reapply_allowed) ? (
            <StartRevisionButton
              previousApplicationId={app.id}
              label={
                app.status === "withdrawn"
                  ? "Start a new application"
                  : "Submit a revised application"
              }
            />
          ) : null}
        </CardBody>
      </Card>

      {events.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-3">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="border-b border-surface-border/60 pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink">
                      {event.message || event.action.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-ink-subtle">{formatDateTime(event.created_at)}</p>
                  </div>
                  {event.from_status || event.to_status ? (
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {event.from_status ? applicationStatusLabel(event.from_status) : "—"}
                      {" → "}
                      {event.to_status ? applicationStatusLabel(event.to_status) : "—"}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
