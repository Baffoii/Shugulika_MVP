import type { Metadata } from "next";
import Link from "next/link";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Alert,
  Badge,
  StatCard,
} from "@/components/ui/primitives";
import { requireApprovedEmployer } from "@/lib/auth";
import { getEmployerPlanSnapshot, listActivePackages } from "@/lib/employer-entitlements";
import { formatDate } from "@/lib/format";
import { AddonShop } from "./AddonShop";

export const metadata: Metadata = { title: "Billing" };

export default async function EmployerBillingPage() {
  const { employerOrg } = await requireApprovedEmployer();
  const [plan, addons] = await Promise.all([
    getEmployerPlanSnapshot(employerOrg.id),
    listActivePackages("addon"),
  ]);

  return (
    <div>
      <PageHeader
        title="Billing & unlocks"
        description="Your plan, job slots, and CV unlock balance. Payments are open in this MVP — top-ups apply immediately."
        actions={
          plan.isActive ? (
            <Link
              href="/employer/plan"
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Upgrade plan
            </Link>
          ) : (
            <Link
              href="/employer/plan"
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Choose a plan
            </Link>
          )
        }
      />

      {!plan.isActive ? (
        <div className="mb-4">
          <Alert tone="warn">
            You do not have an active plan.{" "}
            <Link href="/employer/plan" className="font-medium underline">
              Start a free trial or choose a package
            </Link>{" "}
            to post jobs and unlock CVs.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="CV unlocks left" value={plan.cvUnlockBalance} tone="brand" />
        <StatCard
          label="Job slots used"
          value={`${plan.jobSlotsUsed} / ${plan.jobSlotLimit || "—"}`}
          tone="info"
        />
        <StatCard label="Plan" value={plan.package?.name ?? "None"} tone="neutral" />
        <StatCard
          label={plan.subscription?.is_trial ? "Trial ends" : "Period ends"}
          value={
            plan.subscription?.is_trial
              ? formatDate(plan.subscription.trial_ends_on)
              : formatDate(plan.subscription?.expires_on ?? null)
          }
          tone={plan.isActive ? "success" : "warn"}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current package</CardTitle>
            {plan.subscription?.is_trial ? <Badge tone="success">Trial</Badge> : null}
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            {plan.package ? (
              <>
                <p className="font-medium text-ink">{plan.package.name}</p>
                <p className="text-ink-muted">{plan.package.description}</p>
                <p className="text-ink-subtle">
                  Status: {plan.subscription?.status}
                  {plan.isActive ? " · active" : " · inactive"}
                </p>
              </>
            ) : (
              <p className="text-ink-muted">No package selected yet.</p>
            )}
            <Alert tone="info">
              Live card payments (Zoho Books) are not connected yet. Plan activation and top-ups
              grant access without charging.
            </Alert>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Buy more unlocks</CardTitle>
          </CardHeader>
          <CardBody>
            {plan.isActive ? (
              <AddonShop addons={addons} />
            ) : (
              <p className="text-sm text-ink-muted">
                Activate a plan first, then you can top up CV unlocks and job slots.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
