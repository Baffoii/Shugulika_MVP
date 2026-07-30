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
  getEmployerPlanSnapshot,
  listActivePackages,
} from "@/lib/employer-entitlements";
import { PlanPicker } from "./PlanPicker";

export const metadata: Metadata = { title: "Choose a plan" };

export default async function EmployerPlanPage() {
  const { ctx, employerOrg } = await requireApprovedEmployer();
  const supabase = createClient();
  const [plan, packages, { data: appData }] = await Promise.all([
    getEmployerPlanSnapshot(employerOrg.id),
    listActivePackages("subscription"),
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

  return (
    <div>
      <PageHeader
        title={mode === "upgrade" ? "Upgrade your hiring plan" : "Choose your hiring plan"}
        description={
          mode === "upgrade"
            ? "Move to the next tier or higher. Lower plans and free trial are hidden while you have an active subscription."
            : "Start a free trial or pick a package. CV unlocks work like chapter coins — browse masked teasers free, spend an unlock to open a full candidate pack."
        }
      />
      <div className="mb-4 space-y-3">
        <Alert tone="info">
          Payments are not charged in this MVP — selecting a plan or trial unlocks access
          immediately. Card billing via Zoho Books will plug in later.
        </Alert>
        {plan.isExpiredTrial ? (
          <Alert tone="warn">
            Your free trial has ended. Choose a paid package to keep posting jobs and unlocking CVs.
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
              person&apos;s full pack inside Shugulika. Re-opening an unlocked candidate is free.
              Buy more unlocks anytime from Billing.
            </p>
            <p>
              Job postings use separate <strong className="text-ink">active job slots</strong> —
              they are capacity limits, not spendable coins.
            </p>
          </CardBody>
        </Card>
      </div>

      <PlanPicker
        packages={visiblePackages}
        preferredKey={preferredKey}
        currentPackageKey={currentKey}
        mode={mode}
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
