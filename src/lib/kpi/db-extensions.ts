/**
 * Row shapes for the tables/columns added by the 20260805* migrations.
 *
 * `src/lib/database.types.ts` is generated and is deliberately not regenerated
 * in this workstream, so these live here as a local, hand-maintained schema
 * fragment. Keep them in sync with:
 *   * 20260805090000_recruiter_kpi_target_versions.sql
 *   * 20260805091000_recruiter_kpi_response_inputs.sql
 *
 * Pure types + mappers only — no I/O, so they stay unit-testable.
 */
import type {
  ConsentResponseSnapshot,
  InterviewScheduleChange,
  StaffNotificationSnapshot,
} from "./definitions";
import type {
  KpiTargetMetrics,
  RecruiterLevelKey,
  TargetVersionRecord,
} from "./target-versions";
import { metricsFromPayload } from "./target-versions";

export type Jsonish = Record<string, unknown>;

export type RecruiterKpiTargetVersionRow = {
  id: string;
  target_id: string | null;
  organization_id: string | null;
  recruiter_level: RecruiterLevelKey;
  metrics: Jsonish;
  effective_from: string;
  superseded_at: string | null;
  changed_by: string | null;
  created_at: string;
};

export type KpiResponseSlaRow = {
  id: string;
  scope_key: "employer_submission" | "candidate_interview" | "candidate_consent";
  organization_id: string | null;
  max_hours: number;
};

export type KpiInterviewScheduleEventRow = {
  id: number;
  interview_id: string;
  application_id: string | null;
  owning_org_id: string;
  change_kind: "scheduled" | "rescheduled" | "cancelled";
  previous_scheduled_at: string | null;
  new_scheduled_at: string | null;
  actor_id: string | null;
  created_at: string;
};

/** employer_submissions columns added by 20260805091000. */
export type SubmissionResponseColumns = {
  id: string;
  application_id: string | null;
  response_due_at: string | null;
  responded_at: string | null;
};

/** interviews columns added by 20260805091000. */
export type InterviewResponseColumns = {
  id: string;
  application_id: string | null;
  created_at: string;
  candidate_response_due_at: string | null;
  candidate_responded_at: string | null;
};

/** applications columns added by 20260805091000. */
export type ApplicationConsentColumns = {
  id: string;
  consent_requested_at: string | null;
  consent_responded_at: string | null;
};

/** Row shape of `public.kpi_candidate_update_status` (no message content). */
export type CandidateUpdateStatusRow = {
  application_id: string;
  notification_id: string;
  category: string;
  created_at: string;
  read_at: string | null;
};

/**
 * Minimal Supabase `Database` fragment covering only the new tables, so the
 * loader can query them type-safely without touching the generated types.
 */
type Tbl<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] };

export type KpiExtensionDatabase = {
  public: {
    Tables: {
      recruiter_kpi_target_versions: Tbl<RecruiterKpiTargetVersionRow>;
      kpi_response_sla: Tbl<KpiResponseSlaRow>;
      kpi_interview_schedule_events: Tbl<KpiInterviewScheduleEventRow>;
      employer_submissions: Tbl<SubmissionResponseColumns>;
      interviews: Tbl<InterviewResponseColumns>;
      applications: Tbl<ApplicationConsentColumns>;
    };
    Views: Record<string, never>;
    Functions: {
      kpi_candidate_update_status: {
        Args: { p_application_ids: string[] };
        Returns: CandidateUpdateStatusRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export function toTargetVersion(
  row: RecruiterKpiTargetVersionRow,
  fallback: KpiTargetMetrics,
): TargetVersionRecord {
  return {
    id: row.id,
    targetId: row.target_id,
    organizationId: row.organization_id,
    recruiterLevel: row.recruiter_level,
    metrics: metricsFromPayload(row.metrics, fallback),
    effectiveFrom: row.effective_from,
    supersededAt: row.superseded_at,
    changedBy: row.changed_by,
  };
}

export function toScheduleChange(row: KpiInterviewScheduleEventRow): InterviewScheduleChange {
  return {
    applicationId: row.application_id,
    changeKind: row.change_kind,
    createdAt: row.created_at,
  };
}

export function toConsentSnapshot(row: ApplicationConsentColumns): ConsentResponseSnapshot {
  return {
    applicationId: row.id,
    requestedAt: row.consent_requested_at,
    respondedAt: row.consent_responded_at,
  };
}

export function toStaffNotification(row: CandidateUpdateStatusRow): StaffNotificationSnapshot {
  return {
    id: row.notification_id,
    applicationId: row.application_id,
    category: row.category,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/** application_id → most recent candidate-facing update we sent. */
export function lastCandidateUpdateByApp(rows: CandidateUpdateStatusRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    const prev = map.get(r.application_id);
    if (!prev || r.created_at > prev) map.set(r.application_id, r.created_at);
  }
  return map;
}
