import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import {
  getHqFranchiseComparison,
  getFranchiseKpiDashboard,
  getRecruitersWithRoles,
  getRecruiterComparisonRow,
  listKpiTargets,
  type KpiPeriod,
} from "@/lib/data/recruiter-kpis";
import { normalizeRecruiterLevel } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { PeriodSelect } from "@/components/kpis/PeriodSelect";
import { RecruiterComparisonTable } from "@/components/kpis/RecruiterComparisonTable";
import { KpiTargetsForm } from "@/components/kpis/KpiTargetsForm";
import { saveHqKpiTargetsAction } from "./actions";
import type { CountryRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "KPI reports" };

function parsePeriod(raw: string | string[] | undefined): KpiPeriod {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "7d" || v === "90d" || v === "ytd") return v;
  return "30d";
}

export default async function HqReportsPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  await requirePortal("hq");
  const params = await Promise.resolve(searchParams ?? {});
  const range = parsePeriod(params.range);
  const country = typeof params.country === "string" ? params.country : undefined;
  const franchiseId = typeof params.franchise === "string" ? params.franchise : undefined;

  const supabase = createClient();
  const [{ data: countries }, { data: franchises }, franchiseRows, platformTargets] =
    await Promise.all([
      supabase.from("countries").select("code,name").eq("is_active", true).order("sort_order"),
      supabase
        .from("organizations")
        .select("id,name,country_code")
        .eq("org_type", "franchise")
        .eq("status", "active")
        .order("name"),
      getHqFranchiseComparison({ countryCode: country, organizationId: franchiseId }, range),
      listKpiTargets(null),
    ]);

  const countryOpts = ((countries as Pick<CountryRow, "code" | "name">[] | null) ?? []).map(
    (c) => ({ code: c.code, name: c.name }),
  );
  const franchiseOpts = (
    (franchises as { id: string; name: string; country_code: string | null }[] | null) ?? []
  )
    .filter((f) => !country || f.country_code === country)
    .map((f) => ({ id: f.id, name: f.name }));

  // Cross-franchise recruiter comparison (aggregates only)
  const recruiters = await getRecruitersWithRoles({
    organizationId: franchiseId,
    regionCode: country,
  });
  const recruiterRows = [];
  for (const r of recruiters.slice(0, 50)) {
    recruiterRows.push(
      await getRecruiterComparisonRow(
        r.recruiterId,
        {
          name: r.name,
          email: r.email,
          level: normalizeRecruiterLevel(r.level),
          regionCode: r.regionCode,
          organizationId: r.organizationId,
          organizationName: null,
        },
        range,
      ),
    );
  }
  recruiterRows.sort((a, b) => b.slaOverdue - a.slaOverdue);

  let drill = null;
  if (franchiseId) {
    drill = await getFranchiseKpiDashboard(franchiseId, range, country);
  }

  return (
    <div>
      <PageHeader
        title="Network KPI reports"
        description="Same KPI definitions as recruiter and franchise views. Aggregates only — no private notes, contacts, or employer feedback."
      />

      <Suspense fallback={<Skeleton className="mb-6 h-10 w-full max-w-xl" />}>
        <PeriodSelect
          range={range}
          countryCode={country}
          countries={countryOpts}
          franchiseId={franchiseId}
          franchises={franchiseOpts}
        />
      </Suspense>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Franchises" value={franchiseRows.length} tone="brand" />
        <StatCard label="Recruiters (listed)" value={recruiterRows.length} tone="neutral" />
        <StatCard
          label="Active jobs (sum)"
          value={franchiseRows.reduce((s, r) => s + r.activeJobs, 0)}
          tone="info"
        />
        <StatCard
          label="SLA overdue (sum)"
          value={franchiseRows.reduce((s, r) => s + r.slaOverdue, 0)}
          tone="warn"
        />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Franchise comparison</CardTitle>
          </CardHeader>
          {franchiseRows.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">No franchises match these filters.</p>
          ) : (
            <DataTable className="border-0 shadow-none">
              <THead>
                <TR>
                  <TH>Franchise</TH>
                  <TH>Country</TH>
                  <TH>Recruiters</TH>
                  <TH>Jobs</TH>
                  <TH>Apps</TH>
                  <TH>Placements</TH>
                  <TH>Place %</TH>
                  <TH>TTF</TH>
                  <TH>Invoices</TH>
                  <TH>SLA</TH>
                </TR>
              </THead>
              <tbody>
                {franchiseRows.map((f) => (
                  <TR key={f.organizationId}>
                    <TD>
                      <Link
                        href={`/hq/reports?franchise=${f.organizationId}${
                          country ? `&country=${country}` : ""
                        }&range=${range}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {f.organizationName}
                      </Link>
                    </TD>
                    <TD>{f.countryCode ?? "—"}</TD>
                    <TD className="tabular-nums">{f.recruiterHeadcount}</TD>
                    <TD className="tabular-nums">{f.activeJobs}</TD>
                    <TD className="tabular-nums">{f.activeApplications}</TD>
                    <TD className="tabular-nums">{f.placements}</TD>
                    <TD className="tabular-nums">
                      {f.placementRate == null ? "—" : `${f.placementRate}%`}
                    </TD>
                    <TD className="tabular-nums">
                      {f.medianTimeToFillDays == null ? "—" : `${f.medianTimeToFillDays}d`}
                    </TD>
                    <TD className="tabular-nums">{f.openInvoices}</TD>
                    <TD className="tabular-nums font-medium">{f.slaOverdue}</TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>

      {drill ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Drill: active apps" value={drill.activeApplications} tone="info" />
          <StatCard label="Drill: placements" value={drill.currentPlacements} tone="success" />
          <StatCard
            label="Drill: placement rate"
            value={drill.placementRate.value == null ? "—" : `${drill.placementRate.value}%`}
            tone="brand"
          />
          <StatCard label="Drill: rejections" value={drill.rejectionTotal} tone="warn" />
        </div>
      ) : null}

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Recruiter comparison (network)</CardTitle>
          </CardHeader>
          <RecruiterComparisonTable rows={recruiterRows} manageBasePath="/hq/recruiters" />
        </Card>
      </div>

      <div className="mt-6">
        <KpiTargetsForm
          initial={platformTargets}
          organizationId={null}
          sourceLabel="platform defaults (HQ)"
          saveAction={saveHqKpiTargetsAction}
        />
        <p className="mt-2 text-xs text-ink-subtle">
          Platform targets apply when a franchise has no override. Changes are audited.
        </p>
      </div>
    </div>
  );
}
