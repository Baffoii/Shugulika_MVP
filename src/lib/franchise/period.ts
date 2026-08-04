import type { DateWindow, KpiPeriod } from "@/lib/kpi/definitions";
import { periodToWindow } from "@/lib/kpi/definitions";
import type { FranchisePeriodGrain } from "@/lib/franchise/types";

/**
 * Map franchise period bar grains onto the shared KPI period API.
 * day/week/month/year are first-class in franchise-owned loaders; KPI dashboard
 * uses the nearest supported KpiPeriod without editing recruiter-kpis.ts.
 */
export function franchiseGrainToKpiPeriod(grain: FranchisePeriodGrain): KpiPeriod {
  switch (grain) {
    case "day":
    case "week":
    case "7d":
      return "7d";
    case "month":
    case "30d":
      return "30d";
    case "90d":
      return "90d";
    case "year":
    case "ytd":
      return "ytd";
    case "custom":
      return "custom";
    default:
      return "30d";
  }
}

export function parseFranchisePeriodGrain(
  raw: string | string[] | undefined,
): FranchisePeriodGrain {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "day" ||
    v === "week" ||
    v === "month" ||
    v === "year" ||
    v === "7d" ||
    v === "30d" ||
    v === "90d" ||
    v === "ytd" ||
    v === "custom"
  ) {
    return v;
  }
  return "30d";
}

export function franchisePeriodWindow(
  grain: FranchisePeriodGrain,
  now = new Date(),
  custom?: { since?: string; until?: string },
): DateWindow {
  if (grain === "custom" && custom?.since && custom?.until) {
    return periodToWindow("custom", now, { since: custom.since, until: custom.until });
  }
  if (grain === "day") {
    const until = now.toISOString();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    return { since, until };
  }
  if (grain === "week") {
    const until = now.toISOString();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return { since, until };
  }
  if (grain === "month") {
    const until = now.toISOString();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    return { since, until };
  }
  if (grain === "year") {
    return periodToWindow("ytd", now);
  }
  return periodToWindow(franchiseGrainToKpiPeriod(grain), now);
}

export function parseFranchiseSort(
  raw: string | string[] | undefined,
): import("@/lib/franchise/types").FranchiseSortMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (
    v === "alpha_asc" ||
    v === "alpha_desc" ||
    v === "newest" ||
    v === "oldest" ||
    v === "sla_first"
  ) {
    return v;
  }
  return "sla_first";
}

export function sortByName<T extends { name: string }>(
  rows: T[],
  mode: "alpha_asc" | "alpha_desc",
): T[] {
  const copy = [...rows];
  copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  if (mode === "alpha_desc") copy.reverse();
  return copy;
}
