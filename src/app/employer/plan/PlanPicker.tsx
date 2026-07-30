"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardBody, CardHeader, CardTitle, Badge } from "@/components/ui/primitives";
import { activateEmployerPackageAction } from "@/app/employer/plan-actions";
import type { PackageRow } from "@/lib/database.types";

const PACKAGE_BLURBS: Record<string, { jobs: string; unlocks: string }> = {
  trial: { jobs: "2 job slots", unlocks: "5 CV unlocks · 14 days" },
  starter: { jobs: "2 job slots", unlocks: "5 CV unlocks / month" },
  growth: { jobs: "5 job slots", unlocks: "15 CV unlocks / month" },
  scale: { jobs: "12 job slots", unlocks: "40 CV unlocks / month" },
};

export function PlanPicker({
  packages,
  preferredKey,
  currentPackageKey,
  mode = "choose",
}: {
  packages: PackageRow[];
  preferredKey: string | null;
  currentPackageKey?: string | null;
  mode?: "choose" | "upgrade";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function activate(key: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await activateEmployerPackageAction(key, key === "trial");
        if (result && !result.ok) setError(result.error ?? "Could not activate plan.");
      } catch {
        // redirect() throws; treat as success path
      }
    });
  }

  if (packages.length === 0) {
    return (
      <p className="rounded-lg border border-surface-border bg-surface-muted px-4 py-3 text-sm text-ink-muted">
        {mode === "upgrade"
          ? "You are already on the highest plan. Top up CV unlocks or job slots from Billing instead."
          : "No plans are available right now."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-status-danger/30 bg-status-danger/5 px-3 py-2 text-sm text-status-danger">
          {error}
        </p>
      ) : null}
      {mode === "upgrade" && currentPackageKey ? (
        <p className="text-sm text-ink-muted">
          Current plan: <span className="font-medium text-ink">{currentPackageKey}</span>. Showing
          the next tier and higher only.
        </p>
      ) : null}
      <div
        className={`grid gap-4 md:grid-cols-2 ${packages.length >= 3 ? "xl:grid-cols-3" : packages.length === 4 ? "xl:grid-cols-4" : ""}`}
      >
        {packages.map((pkg) => {
          const blurb = PACKAGE_BLURBS[pkg.key] ?? { jobs: "Job slots", unlocks: "CV unlocks" };
          const isPreferred = preferredKey === pkg.key && pkg.key !== currentPackageKey;
          const isCurrent = Boolean(currentPackageKey && pkg.key === currentPackageKey);
          const isTrial = pkg.key === "trial";
          return (
            <Card
              key={pkg.id}
              className={
                isCurrent
                  ? "ring-2 ring-emerald-500"
                  : isPreferred
                    ? "ring-2 ring-brand-500"
                    : undefined
              }
            >
              <CardHeader>
                <div>
                  <CardTitle>{pkg.name}</CardTitle>
                  {isPreferred ? (
                    <p className="mt-0.5 text-xs text-brand-700">
                      You flagged interest during signup
                    </p>
                  ) : null}
                </div>
                {isCurrent ? (
                  <Badge tone="success">Current</Badge>
                ) : isTrial ? (
                  <Badge tone="success">Free trial</Badge>
                ) : mode === "upgrade" ? (
                  <Badge tone="info">Upgrade</Badge>
                ) : null}
              </CardHeader>
              <CardBody className="space-y-3">
                <p className="text-sm text-ink-muted">{pkg.description}</p>
                <ul className="space-y-1 text-sm text-ink">
                  <li>{blurb.jobs}</li>
                  <li>{blurb.unlocks}</li>
                </ul>
                <Button
                  disabled={pending || isCurrent}
                  onClick={() => activate(pkg.key)}
                  className="w-full"
                  variant={isCurrent ? "outline" : "primary"}
                >
                  {isCurrent
                    ? "Current plan"
                    : pending
                      ? mode === "upgrade"
                        ? "Upgrading…"
                        : "Activating…"
                      : isTrial
                        ? "Start free trial"
                        : mode === "upgrade"
                          ? `Upgrade to ${pkg.name}`
                          : `Choose ${pkg.name}`}
                </Button>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
