/**
 * Employer package entitlements + CV unlock tokens.
 *
 * Commercial rules (approved 2026-08-04 — Sabiha/finance):
 * - CV unlocks are org-scoped: unique (employer_org_id, candidate_id). Once
 *   unlocked, the candidate stays unlocked for that employer org across jobs.
 * - Path A job_order_id authorizes spend/preview; it is not the unlock key.
 * - CV unlock credits expire per subscription month (period-lapsed grant
 *   remaining is burned by expire_employer_entitlements).
 * - Job-slot add-ons apply only during the associated plan period.
 * - Paid plan/add-on activation is sandbox-only until real payment verification
 *   exists. Free trial remains available. Production must keep sandbox disabled.
 */
import { createClient } from "@/lib/supabase/server";
import type {
  EmployerSubscriptionRow,
  Json,
  PackageEntitlementRow,
  PackageRow,
} from "@/lib/database.types";

export const SUBSCRIPTION_PACKAGE_KEYS = ["trial", "starter", "growth", "scale"] as const;
export type SubscriptionPackageKey = (typeof SUBSCRIPTION_PACKAGE_KEYS)[number];

export const ADDON_PACKAGE_KEYS = ["cv_unlocks_5", "cv_unlocks_15", "job_slot_1"] as const;
export type AddonPackageKey = (typeof ADDON_PACKAGE_KEYS)[number];

export const EMPLOYER_PAYMENTS_SANDBOX_FLAG = "employer_payments_sandbox_enabled" as const;

/**
 * Env-only sandbox switch. Prefer getEmployerPaymentsCapability() for UI/actions;
 * open payments require non-production AND this env AND the DB flag.
 */
export function isEmployerPaymentsSandbox(): boolean {
  return process.env.EMPLOYER_PAYMENTS_SANDBOX === "true";
}

/** Non-production when VERCEL_ENV is set and not production; else NODE_ENV !== production. */
export function isNonProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== "") {
    return env.VERCEL_ENV !== "production";
  }
  return env.NODE_ENV !== "production";
}

export type EmployerPaymentsCapability = {
  openPaymentsAllowed: boolean;
  isNonProduction: boolean;
  envSandboxEnabled: boolean;
  dbSandboxEnabled: boolean;
  blockedReasons: string[];
};

/**
 * Pure assembler — never enables open payments unless all three inputs are true.
 * Production deployments always yield openPaymentsAllowed=false.
 */
export function buildEmployerPaymentsCapability(input: {
  isNonProduction: boolean;
  envSandboxEnabled: boolean;
  dbSandboxEnabled: boolean;
}): EmployerPaymentsCapability {
  const { isNonProduction, envSandboxEnabled, dbSandboxEnabled } = input;
  const blockedReasons: string[] = [];
  if (!isNonProduction) blockedReasons.push("deployment is production");
  if (!envSandboxEnabled) blockedReasons.push("EMPLOYER_PAYMENTS_SANDBOX is not true");
  if (!dbSandboxEnabled) {
    blockedReasons.push(`${EMPLOYER_PAYMENTS_SANDBOX_FLAG} is off`);
  }
  const openPaymentsAllowed = isNonProduction && envSandboxEnabled && dbSandboxEnabled;
  return {
    openPaymentsAllowed,
    isNonProduction,
    envSandboxEnabled,
    dbSandboxEnabled,
    blockedReasons: openPaymentsAllowed ? [] : blockedReasons,
  };
}

/**
 * Server-computed sandbox capability. Single source of truth for plan/billing UI
 * and soft-gates in plan-actions. SQL still enforces the DB flag on RPCs.
 */
export async function getEmployerPaymentsCapability(): Promise<EmployerPaymentsCapability> {
  const supabase = createClient();
  const { data } = await supabase
    .from("feature_flags")
    .select("is_enabled")
    .eq("key", EMPLOYER_PAYMENTS_SANDBOX_FLAG)
    .maybeSingle();
  return buildEmployerPaymentsCapability({
    isNonProduction: isNonProductionDeployment(),
    envSandboxEnabled: isEmployerPaymentsSandbox(),
    dbSandboxEnabled: Boolean((data as { is_enabled?: boolean } | null)?.is_enabled),
  });
}

/** Ladder rank for upgrade filtering (trial is lowest). */
export function subscriptionPackageRank(key: string | null | undefined): number {
  if (!key) return -1;
  const idx = (SUBSCRIPTION_PACKAGE_KEYS as readonly string[]).indexOf(key);
  return idx;
}

/**
 * When already on a plan, show the current plan plus the next (adjacent) tier and higher.
 * First-time choosers (no current key) see the full ladder including trial.
 */
export function filterPackagesForPlanPicker(
  packages: PackageRow[],
  currentPackageKey: string | null,
): PackageRow[] {
  const ranked = [...packages].sort((a, b) => {
    const ra = subscriptionPackageRank(a.key);
    const rb = subscriptionPackageRank(b.key);
    if (ra !== rb) return ra - rb;
    return a.tier - b.tier;
  });
  if (!currentPackageKey) return ranked;

  const currentRank = subscriptionPackageRank(currentPackageKey);
  if (currentRank < 0) return ranked;

  // Current + adjacent higher + anything above.
  return ranked.filter((pkg) => subscriptionPackageRank(pkg.key) >= currentRank);
}

export type EmployerPlanSnapshot = {
  subscription: EmployerSubscriptionRow | null;
  package: PackageRow | null;
  entitlements: PackageEntitlementRow[];
  cvUnlockBalance: number;
  jobSlotsUsed: number;
  jobSlotLimit: number;
  isActive: boolean;
  isExpiredTrial: boolean;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function subscriptionIsCurrentlyActive(sub: EmployerSubscriptionRow | null): boolean {
  if (!sub) return false;
  if (sub.status !== "trial" && sub.status !== "active") return false;
  const today = todayIsoDate();
  if (sub.expires_on && sub.expires_on < today) return false;
  if (sub.is_trial && sub.trial_ends_on && sub.trial_ends_on < today) return false;
  return true;
}

export async function listActivePackages(kind: "subscription" | "addon" = "subscription") {
  const supabase = createClient();
  const { data } = await supabase
    .from("packages")
    .select("*")
    .eq("is_active", true)
    .eq("package_kind", kind)
    .order("tier", { ascending: true });
  return (data as PackageRow[] | null) ?? [];
}

export async function getEmployerPlanSnapshot(
  employerOrgId: string,
): Promise<EmployerPlanSnapshot> {
  const supabase = createClient();
  // Prefer a live subscription over an expired one (same starts_on can collide after re-seeds).
  const [{ data: liveSub }, { data: balData }, { data: used }, { data: limit }] = await Promise.all(
    [
      supabase
        .from("employer_subscriptions")
        .select("*")
        .eq("employer_org_id", employerOrgId)
        .in("status", ["trial", "active"])
        .order("starts_on", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("employer_cv_unlock_balances")
        .select("balance")
        .eq("employer_org_id", employerOrgId)
        .maybeSingle(),
      supabase.rpc("count_employer_active_job_slots", { p_employer_org: employerOrgId }),
      supabase.rpc("employer_job_slot_limit", { p_employer_org: employerOrgId }),
    ],
  );

  let subscription = (liveSub as EmployerSubscriptionRow | null) ?? null;
  if (!subscription) {
    const { data: expiredSub } = await supabase
      .from("employer_subscriptions")
      .select("*")
      .eq("employer_org_id", employerOrgId)
      .eq("status", "expired")
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    subscription = (expiredSub as EmployerSubscriptionRow | null) ?? null;
  }

  let pkg: PackageRow | null = null;
  let entitlements: PackageEntitlementRow[] = [];
  if (subscription) {
    const [{ data: pkgData }, { data: entData }] = await Promise.all([
      supabase.from("packages").select("*").eq("id", subscription.package_id).maybeSingle(),
      supabase.from("package_entitlements").select("*").eq("package_id", subscription.package_id),
    ]);
    pkg = (pkgData as PackageRow | null) ?? null;
    entitlements = (entData as PackageEntitlementRow[] | null) ?? [];
  }

  const isActive = subscriptionIsCurrentlyActive(subscription);
  const isExpiredTrial = Boolean(
    subscription?.is_trial &&
    (subscription.status === "expired" ||
      (subscription.trial_ends_on && subscription.trial_ends_on < todayIsoDate())) &&
    !isActive,
  );

  return {
    subscription,
    package: pkg,
    entitlements,
    cvUnlockBalance: (balData as { balance: number } | null)?.balance ?? 0,
    jobSlotsUsed: typeof used === "number" ? used : 0,
    jobSlotLimit: typeof limit === "number" ? limit : 0,
    isActive,
    isExpiredTrial,
  };
}

export async function assertCanPostJob(
  employerOrgId: string,
): Promise<{ allowed: boolean; error?: string }> {
  const plan = await getEmployerPlanSnapshot(employerOrgId);
  if (!plan.isActive) {
    return {
      allowed: false,
      error: "Choose a plan or start a free trial before posting a job.",
    };
  }
  if (plan.jobSlotLimit > 0 && plan.jobSlotsUsed >= plan.jobSlotLimit) {
    return {
      allowed: false,
      error: `You have used all ${plan.jobSlotLimit} active job slots. Close a role or buy an extra job slot.`,
    };
  }
  return { allowed: true };
}

export async function isCandidateUnlocked(
  employerOrgId: string,
  candidateId: string,
): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("employer_cv_unlocks")
    .select("id")
    .eq("employer_org_id", employerOrgId)
    .eq("candidate_id", candidateId)
    .maybeSingle();
  return Boolean(data);
}

export type MaskedDisclosedProfile = {
  headline: string | null;
  location: string | null;
  summary: string | null;
  availability: string | null;
  test_name: string | null;
  test_score: string | null;
  skills_teaser?: string | null;
};

export type FullDisclosedProfile = MaskedDisclosedProfile & {
  full_name: string | null;
  given_name: string | null;
  family_name: string | null;
};

export function buildEmployerDisclosedProfiles(input: {
  given_name: string | null;
  family_name: string | null;
  headline: string | null;
  city: string | null;
  country_code: string | null;
  summary: string | null;
  availability: string | null;
  test_name: string | null;
  test_score: string | null;
}): { masked: MaskedDisclosedProfile; full: FullDisclosedProfile } {
  const fullName = [input.given_name, input.family_name].filter(Boolean).join(" ").trim() || null;
  const location = [input.city, input.country_code].filter(Boolean).join(", ") || null;
  const masked: MaskedDisclosedProfile = {
    headline: input.headline,
    location,
    summary: input.summary,
    availability: input.availability,
    test_name: input.test_name,
    test_score: input.test_score,
  };
  const full: FullDisclosedProfile = {
    ...masked,
    full_name: fullName,
    given_name: input.given_name,
    family_name: input.family_name,
  };
  return { masked, full };
}

export function teaserLabel(disclosed: unknown, unlocked: boolean, fallbackId: string): string {
  const d = (disclosed ?? {}) as Partial<FullDisclosedProfile>;
  if (unlocked) {
    const name =
      d.full_name?.trim() || [d.given_name, d.family_name].filter(Boolean).join(" ").trim() || null;
    if (name) return name;
  }
  if (d.headline?.trim()) return d.headline.trim();
  return `Candidate ${fallbackId.slice(0, 8)}`;
}

export function asJson(value: unknown): Json {
  return value as Json;
}
