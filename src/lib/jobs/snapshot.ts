import { createHash } from "node:crypto";
import type { JobOrderMaterialSnapshot } from "@/lib/jobs/types";

type SnapshotSource = {
  employer_org_id: string;
  responsible_org_id: string;
  origin: "employer_online" | "shugulika_offline";
  title: string;
  department?: string | null;
  description?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  employment_type?: string | null;
  work_arrangement?: string | null;
  experience_level?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_public: boolean;
  benefits?: string | null;
  country_code: string;
  city?: string | null;
  vacancy_count: number;
  recruitment_path: "A" | "B" | string;
  is_confidential: boolean;
  application_deadline?: string | null;
  target_start_date?: string | null;
  assessment_mode?: "shugulika" | "employer" | "both";
  assessment_seniority?: "junior" | "senior";
  assessment_pass_threshold?: number;
  assessment_file_bucket?: string | null;
  assessment_file_path?: string | null;
  assessment_file_name?: string | null;
  assessment_file_mime?: string | null;
  assessment_file_size?: number | null;
  assessment_files?: JobOrderMaterialSnapshot["assessment_files"];
  screening_questions?: JobOrderMaterialSnapshot["screening_questions"];
};

/** Build the canonical material snapshot used for approval hashes. */
export function buildJobOrderMaterialSnapshot(order: SnapshotSource): JobOrderMaterialSnapshot {
  return {
    employer_org_id: order.employer_org_id,
    responsible_org_id: order.responsible_org_id,
    origin: order.origin,
    title: order.title,
    department: order.department ?? "",
    description: order.description ?? "",
    responsibilities: order.responsibilities ?? "",
    requirements: order.requirements ?? "",
    employment_type: order.employment_type ?? "",
    work_arrangement: order.work_arrangement ?? "",
    experience_level: order.experience_level ?? "",
    salary_min: order.salary_min ?? null,
    salary_max: order.salary_max ?? null,
    salary_currency: order.salary_currency ?? "",
    salary_public: order.salary_public,
    benefits: order.benefits ?? "",
    country_code: order.country_code,
    city: order.city ?? "",
    vacancy_count: order.vacancy_count,
    recruitment_path: order.recruitment_path === "A" ? "A" : "B",
    is_confidential: order.is_confidential,
    application_deadline: order.application_deadline ?? null,
    target_start_date: order.target_start_date ?? null,
    assessment_mode: order.assessment_mode ?? "shugulika",
    assessment_seniority: order.assessment_seniority ?? "junior",
    assessment_pass_threshold: order.assessment_pass_threshold ?? 65,
    assessment_file_bucket: order.assessment_file_bucket ?? null,
    assessment_file_path: order.assessment_file_path ?? null,
    assessment_file_name: order.assessment_file_name ?? null,
    assessment_file_mime: order.assessment_file_mime ?? null,
    assessment_file_size: order.assessment_file_size ?? null,
    assessment_files: order.assessment_files ?? [],
    screening_questions: order.screening_questions ?? [],
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
