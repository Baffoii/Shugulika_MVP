"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { purchaseEmployerAddonAction } from "@/app/employer/plan-actions";
import type { PackageRow } from "@/lib/database.types";

export function AddonShop({ addons }: { addons: PackageRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buy(key: string) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await purchaseEmployerAddonAction(key);
      if (!result.ok) {
        setError(result.error ?? "Could not apply top-up.");
        return;
      }
      setMessage(result.message ?? "Top-up applied.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-sm text-status-danger">{error}</p> : null}
      {message ? <p className="text-sm text-status-success">{message}</p> : null}
      <ul className="space-y-2">
        {addons.map((addon) => (
          <li
            key={addon.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-ink">{addon.name}</p>
              <p className="text-xs text-ink-subtle">{addon.description}</p>
            </div>
            <Button size="sm" disabled={pending} onClick={() => buy(addon.key)}>
              {pending ? "…" : "Add"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
