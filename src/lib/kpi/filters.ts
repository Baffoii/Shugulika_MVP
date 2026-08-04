/**
 * KPI filter parsing + date grains — pure, no I/O.
 *
 * Two rules this module exists to enforce:
 *
 *  1. A recruiter's KPI scope is derived from their session, never from the
 *     query string. `parseKpiFilters` deliberately drops any recruiter/owner/
 *     organization parameter, so a hand-edited URL cannot widen the scope or
 *     probe for another recruiter's unassigned applications.
 *  2. Nationality is not a filter, score, or rank signal anywhere in the
 *     product. Unknown keys — nationality included — are dropped, and
 *     `containsProhibitedFilterKey` gives tests a direct assertion.
 */

export const KPI_GRAINS = ["day", "week", "month", "year", "custom"] as const;
export type KpiGrain = (typeof KPI_GRAINS)[number];

export const KPI_GRAIN_LABELS: Record<KpiGrain, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
  custom: "Custom range",
};

/**
 * Filter keys a recruiter may set. Anything else in the query string is
 * ignored. `recruiter`, `owner`, `org`, and `nationality` are absent by design.
 */
export const ALLOWED_FILTER_KEYS = [
  "grain",
  "from",
  "to",
  "role",
  "employer",
  "job",
  "stage",
  "kind",
] as const;
export type AllowedFilterKey = (typeof ALLOWED_FILTER_KEYS)[number];

/**
 * Keys that must never become filters. Nationality is prohibited as an
 * employment-discrimination risk; the rest would let a recruiter re-scope the
 * dashboard to someone else's work.
 */
export const PROHIBITED_FILTER_KEYS = [
  "nationality",
  "nationalities",
  "citizenship",
  "national_origin",
  "recruiter",
  "recruiterid",
  "recruiter_id",
  "owner",
  "owneruserid",
  "assignee",
  "assigned_recruiter_id",
  "organization",
  "organizationid",
  "organization_id",
  "org",
  "orgid",
] as const;

export function containsProhibitedFilterKey(keys: Iterable<string>): boolean {
  const prohibited = new Set<string>(PROHIBITED_FILTER_KEYS);
  for (const key of keys) {
    if (prohibited.has(key.toLowerCase())) return true;
  }
  return false;
}

export interface KpiFilterState {
  grain: KpiGrain;
  /** YYYY-MM-DD, only meaningful when grain === "custom". */
  from?: string;
  to?: string;
  /** job_roles.id — must be one of the recruiter's own assigned roles. */
  roleId?: string;
  /** Employer organization id — must be one of the recruiter's own employers. */
  employerOrgId?: string;
  /** job_orders.id — must be one of the recruiter's own jobs. */
  jobOrderId?: string;
  /** Pipeline stage key. */
  stage?: string;
  /** Selected attention kind for the drill-down panel. */
  kind?: string;
}

type RawParams = Record<string, string | string[] | undefined>;

function one(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (v ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseGrain(raw: string | string[] | undefined): KpiGrain {
  const v = one(raw)?.toLowerCase();
  if (v && (KPI_GRAINS as readonly string[]).includes(v)) return v as KpiGrain;
  // Legacy period params from the pre-grain dashboard.
  if (v === "7d" || v === "week") return "week";
  if (v === "90d" || v === "quarter") return "month";
  if (v === "ytd" || v === "year") return "year";
  return "month";
}

/**
 * Parse a recruiter's KPI filters from search params. Only `ALLOWED_FILTER_KEYS`
 * are read; ownership and organization come from the session, not the URL.
 */
export function parseKpiFilters(params: RawParams): KpiFilterState {
  const grain = parseGrain(params.grain ?? params.range);
  const from = one(params.from);
  const to = one(params.to);
  return {
    grain,
    from: from && DATE_RE.test(from) ? from : undefined,
    to: to && DATE_RE.test(to) ? to : undefined,
    roleId: one(params.role),
    employerOrgId: one(params.employer),
    jobOrderId: one(params.job),
    stage: one(params.stage),
    kind: one(params.kind),
  };
}

/**
 * Keep only filter values the recruiter is actually entitled to. An id that is
 * not in their own option list is dropped silently — the dashboard then renders
 * the unfiltered scope rather than an error that would confirm the id exists.
 */
export function constrainFiltersToOptions(
  filters: KpiFilterState,
  options: {
    roleIds: Iterable<string>;
    employerOrgIds: Iterable<string>;
    jobOrderIds: Iterable<string>;
    stages: Iterable<string>;
  },
): KpiFilterState {
  const roles = new Set(options.roleIds);
  const employers = new Set(options.employerOrgIds);
  const jobs = new Set(options.jobOrderIds);
  const stages = new Set(options.stages);
  return {
    ...filters,
    roleId: filters.roleId && roles.has(filters.roleId) ? filters.roleId : undefined,
    employerOrgId:
      filters.employerOrgId && employers.has(filters.employerOrgId)
        ? filters.employerOrgId
        : undefined,
    jobOrderId: filters.jobOrderId && jobs.has(filters.jobOrderId) ? filters.jobOrderId : undefined,
    stage: filters.stage && stages.has(filters.stage) ? filters.stage : undefined,
  };
}

export interface GrainWindow {
  /** Inclusive UTC ISO start. */
  since: string;
  /** Exclusive UTC ISO end. */
  until: string;
  grain: KpiGrain;
  label: string;
  /** True when the window has already closed — recomputes must use the versioned target. */
  isClosed: boolean;
}

function iso(d: Date): string {
  return d.toISOString();
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Monday-start ISO week. */
function startOfUtcWeek(d: Date): Date {
  const start = startOfUtcDay(d);
  const offset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - offset);
  return start;
}

/**
 * Resolve a grain to a concrete UTC window. Windows are half-open
 * `[since, until)`, matching `inWindow` in definitions.ts.
 */
export function grainToWindow(
  filters: KpiFilterState,
  now: Date = new Date(),
): GrainWindow {
  const nowIso = iso(now);

  if (filters.grain === "custom" && filters.from && filters.to) {
    const since = new Date(`${filters.from}T00:00:00.000Z`);
    // Exclusive end = start of the day after `to`, so the whole `to` day counts.
    const untilDay = new Date(`${filters.to}T00:00:00.000Z`);
    untilDay.setUTCDate(untilDay.getUTCDate() + 1);
    const until = iso(untilDay);
    return {
      since: iso(since),
      until,
      grain: "custom",
      label: `${filters.from} → ${filters.to}`,
      isClosed: until <= nowIso,
    };
  }

  if (filters.grain === "day") {
    const since = startOfUtcDay(now);
    const until = new Date(since);
    until.setUTCDate(until.getUTCDate() + 1);
    return {
      since: iso(since),
      until: iso(until),
      grain: "day",
      label: iso(since).slice(0, 10),
      isClosed: iso(until) <= nowIso,
    };
  }

  if (filters.grain === "week") {
    const since = startOfUtcWeek(now);
    const until = new Date(since);
    until.setUTCDate(until.getUTCDate() + 7);
    return {
      since: iso(since),
      until: iso(until),
      grain: "week",
      label: `Week of ${iso(since).slice(0, 10)}`,
      isClosed: iso(until) <= nowIso,
    };
  }

  if (filters.grain === "year") {
    const since = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const until = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    return {
      since: iso(since),
      until: iso(until),
      grain: "year",
      label: String(now.getUTCFullYear()),
      isClosed: iso(until) <= nowIso,
    };
  }

  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    since: iso(since),
    until: iso(until),
    grain: "month",
    label: iso(since).slice(0, 7),
    isClosed: iso(until) <= nowIso,
  };
}

/**
 * The instant a period's targets should be resolved at: the period end for a
 * closed period, "now" for a period still running.
 */
export function targetResolutionInstant(window: GrainWindow, now: Date = new Date()): string {
  const nowIso = iso(now);
  return window.until <= nowIso ? window.until : nowIso;
}

/** Rebuild a query string from filters, dropping empty values. */
export function serializeKpiFilters(filters: KpiFilterState): string {
  const params = new URLSearchParams();
  params.set("grain", filters.grain);
  if (filters.grain === "custom") {
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
  }
  if (filters.roleId) params.set("role", filters.roleId);
  if (filters.employerOrgId) params.set("employer", filters.employerOrgId);
  if (filters.jobOrderId) params.set("job", filters.jobOrderId);
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.kind) params.set("kind", filters.kind);
  return params.toString();
}
