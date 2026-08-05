import { createHash } from "node:crypto";
import type { JobOrderMaterialSnapshot } from "@/lib/jobs/types";

type SnapshotSource = {
  title: string;
  description?: string | null;
  requirements?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  country_code: string;
  city?: string | null;
  vacancy_count: number;
  recruitment_path: "A" | "B" | string;
  application_deadline?: string | null;
};

/** Build the canonical material snapshot used for approval hashes. */
export function buildJobOrderMaterialSnapshot(order: SnapshotSource): JobOrderMaterialSnapshot {
  return {
    title: order.title,
    description: order.description ?? "",
    requirements: order.requirements ?? "",
    salary_min: order.salary_min ?? null,
    salary_max: order.salary_max ?? null,
    salary_currency: order.salary_currency ?? "",
    country_code: order.country_code,
    city: order.city ?? "",
    vacancy_count: order.vacancy_count,
    recruitment_path: order.recruitment_path === "A" ? "A" : "B",
    application_deadline: order.application_deadline ?? null,
  };
}

/**
 * Match Postgres `encode(digest(snapshot::text, 'sha256'), 'hex')` as closely as
 * practical for app-side checks. DB remains the source of truth at publish time.
 */
export function hashJobOrderMaterialSnapshot(snapshot: JobOrderMaterialSnapshot): string {
  const canonical = JSON.stringify(snapshot);
  return createHash("sha256").update(canonical).digest("hex");
}

export function materialFieldsChanged(before: SnapshotSource, after: SnapshotSource): boolean {
  const a = buildJobOrderMaterialSnapshot(before);
  const b = buildJobOrderMaterialSnapshot(after);
  return hashJobOrderMaterialSnapshot(a) !== hashJobOrderMaterialSnapshot(b);
}
