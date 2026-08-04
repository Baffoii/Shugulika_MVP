import Link from "next/link";
import type { Metadata } from "next";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Alert,
  Badge,
} from "@/components/ui/primitives";
import { requireApprovedEmployer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  filterPackagesForPlanPicker,
  getEmployerPaymentsCapability,
  getEmployerPlanSnapshot,
  listActivePackages,
} from "@/lib/employer-entitlements";
import { PlanPicker } from "./PlanPicker";

export const metadata: Metadata = { title: "Choose a plan" };

export default async function EmployerPlanPage() {
  const { ctx, employerOrg } = await requireApprovedEmployer();
  const supabase = createClient();
  const [plan, packages, payments, { data: appData }] = await Promise.all([
    getEmployerPlanSnapshot(employerOrg.id),
    listActivePackages("subscription"),
    getEmployerPaymentsCapability(),
    supabase
      .from("employer_applications")
      .select("preferred_package_key")
      .eq("applicant_user_id", ctx.userId)
      .eq("status", "approved")
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const preferredKey =
    (appData as { preferred_package_key: string | null } | null)?.preferred_package_key ?? null;
  const currentKey = plan.isActive ? (plan.package?.key ?? null) : null;
  const visiblePackages = filterPackagesForPlanPicker(packages, currentKey);
  const mode = currentKey ? "upgrade" : "choose";
  const openPaymentsAllowed = payments.openPaymentsAllowed;

  return (
    <div>
      <PageHeader
        title={mode === "upgrade" ? "Upgrade your hiring plan" : "Choose your hiring plan"}
        description={
          mode === "upgrade"
            ? "Move to the next tier or higher when paid activation is available. Lower plans and free trial are hidden while you have an active subscription."
            : "Start a free trial. Paid packages activate only when sandbox demo payments are enabled, or after real billing ships."
        }
      />
      <div className="mb-4 space-y-3">
        <Alert tone="info">
          Free trial (14 days) needs no payment. Real paid activation is not implemented yet
          {openPaymentsAllowed
            ? " — sandbox/demo open payments are enabled on this non-production environment."
            : ". Sandbox/demo open payments must be explicitly enabled (non-production, env, and database flag)."}
        </Alert>
        {plan.isExpiredTrial ? (
          <Alert tone="warn">
            Your free trial has ended. A paid package will be required once real billing ships
            {openPaymentsAllowed ? ", or via payments sandbox for demos only." : "."}
          </Alert>
        ) : null}
        {mode === "upgrade" && plan.package ? (
          <Alert tone="info">
            You are on <strong>{plan.package.name}</strong> (marked Current). Only that plan plus
            the next tier and higher are listed.
          </Alert>
        ) : null}
      </div>

      <div className="mb-6">
        <Card>
          <CardHeader>
            <CardTitle>How CV unlocks work</CardTitle>
            <Badge tone="info">Teaser → unlock</Badge>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-ink-muted">
            <p>
              Every package can grant <strong className="text-ink">CV unlocks</strong>. You can
              browse masked candidate teasers for free. Spending one unlock reveals that
              person&apos;s pack inside Shugulika. Unlocks are per company (not per job) —
              re-opening an unlocked candidate does not spend another credit. Unused credits expire
              at the end of the current plan period; spending requires an active plan.
            </p>
            <p>
              Job postings use separate <strong className="text-ink">active job slots</strong> —
              plan slots and job-slot add-ons apply only during the current plan period.
            </p>
          </CardBody>
        </Card>
      </div>

      <PlanPicker
        packages={visiblePackages}
        preferredKey={preferredKey}
        currentPackageKey={currentKey}
        mode={mode}
        openPaymentsAllowed={openPaymentsAllowed}
      />

      <p className="mt-6 text-sm text-ink-subtle">
        {mode === "upgrade" ? (
          <>
            Prefer top-ups instead?{" "}
            <Link href="/employer/billing" className="text-brand-700 hover:underline">
              Open billing
            </Link>
          </>
        ) : (
          <>
            Need company settings first?{" "}
            <Link href="/employer/company" className="text-brand-700 hover:underline">
              Open company profile
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
