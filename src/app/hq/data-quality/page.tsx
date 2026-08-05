import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import {
  PageHeader,
  StatCard,
  Alert,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  ButtonLink,
} from "@/components/ui/primitives";
import { DataTable, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { type HqDataQualityMetrics, getHqDataQualityCoreMetrics } from "@/lib/data/hq-data-quality";
import {
  getHqDataQualitySnapshot,
  getImportHealth,
  getZohoImportFreshness,
} from "@/lib/integrations/zoho-recruit/import/hq-import-metrics";

export const metadata: Metadata = { title: "Data quality" };
export const dynamic = "force-dynamic";

function percent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

/** Rates carry a tone so a number that needs attention reads as one at a glance. */
function rateTone(value: number | null, good: number, bad: number) {
  if (value == null) return "neutral" as const;
  if (value >= good) return "success" as const;
  if (value <= bad) return "danger" as const;
  return "warn" as const;
}

function errorTone(value: number | null) {
  if (value == null) return "neutral" as const;
  if (value === 0) return "success" as const;
  if (value > 0.2) return "danger" as const;
  return "warn" as const;
}

function freshnessLabel(ageHours: number | null): string {
  if (ageHours == null) return "Never";
  if (ageHours < 1) return "Under an hour ago";
  if (ageHours < 48) return `${Math.round(ageHours)}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

export default async function HqDataQualityPage() {
  await requirePortal("hq");
  const [dq, core, imports, zohoFreshness] = await Promise.all([
    getHqDataQualitySnapshot(),
    getHqDataQualityCoreMetrics(),
    getImportHealth(),
    getZohoImportFreshness(),
  ]);
  const metrics: HqDataQualityMetrics = {
    ...core,
    imports,
    freshness: [...core.freshness, zohoFreshness],
  };
  const { parser, confirmation, completeness, duplicates, freshness } = metrics;

  return (
    <div>
      <PageHeader
        title="Data quality operations"
        description="Parser coverage, candidate-confirmed fields, missing required data, suspected duplicates, and import health. Counts only — no candidate values are shown here, and nothing on this page merges anything."
        actions={
          <>
            <ButtonLink href="/hq/merge-review">Merge review</ButtonLink>
            <ButtonLink href="/hq/integrations" variant="secondary">
              Integrations
            </ButtonLink>
          </>
        }
      />

      {/* ---- Candidate-data quality ------------------------------------- */}
      <section aria-labelledby="candidate-data-quality">
        <h2 id="candidate-data-quality" className="mb-3 text-sm font-semibold text-ink">
          Candidate data
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Parser coverage"
            value={percent(parser.coverageRate)}
            hint={`${parser.candidatesWithParseRun} of ${parser.candidatesTotal} candidates parsed`}
            tone={rateTone(parser.coverageRate, 0.7, 0.3)}
          />
          <StatCard
            label="Confirmation rate"
            value={percent(confirmation.confirmationRate)}
            hint={`${confirmation.confirmedFields} of ${confirmation.trackedFields} tracked fields confirmed by a person`}
            tone={rateTone(confirmation.confirmationRate, 0.6, 0.25)}
          />
          <StatCard
            label="Duplicate rate"
            value={percent(duplicates.duplicateRate)}
            hint={`${duplicates.candidatesInvolved} candidate(s) across ${duplicates.suspectedPairs} suspected pair(s)`}
            tone={duplicates.suspectedPairs === 0 ? "success" : "warn"}
          />
          <StatCard
            label="Import error rate"
            value={percent(imports.errorRate)}
            hint={`${imports.recordsQuarantined} quarantined, ${imports.recordsFailed} failed`}
            tone={errorTone(imports.errorRate)}
          />
          <StatCard
            label="Records missing critical fields"
            value={completeness.candidatesIncomplete}
            hint={`of ${completeness.candidatesTotal} candidate records`}
            tone={completeness.candidatesIncomplete === 0 ? "success" : "orange"}
          />
          <StatCard
            label="Low-confidence parsed fields"
            value={confirmation.lowConfidenceFields}
            hint="Machine-extracted and still below the review threshold"
            tone={confirmation.lowConfidenceFields === 0 ? "success" : "warn"}
          />
          <StatCard
            label="Unresolved merge tasks"
            value={duplicates.unresolvedMergeTasks}
            hint={`${duplicates.strongPairs} strong match(es) waiting`}
            tone={duplicates.unresolvedMergeTasks === 0 ? "success" : "warn"}
          />
          <StatCard
            label="Failed parse runs"
            value={parser.failedRuns}
            tone={parser.failedRuns === 0 ? "success" : "warn"}
          />
        </div>
      </section>

      {parser.parserVersions.length > 1 ? (
        <div className="mt-4">
          <Alert tone="warn" title="More than one parser version is in play">
            Confidence scores produced by different parser versions are not directly comparable.
            Re-parse older records before reading confidence trends across the pool.
          </Alert>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Parser versions in the pool</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4">
            {parser.parserVersions.length === 0 ? (
              <p className="text-sm text-ink-muted">No parse runs recorded yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {parser.parserVersions.map((v) => (
                  <Badge key={v.version} tone="neutral">
                    {v.version} · {v.runs} run{v.runs === 1 ? "" : "s"}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Missing critical fields</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4">
            {completeness.byField.some((f) => f.missing > 0) ? (
              <DataTable>
                <THead>
                  <TR>
                    <TH>Field</TH>
                    <TH className="text-right">Records missing it</TH>
                  </TR>
                </THead>
                <tbody>
                  {completeness.byField.map((field) => (
                    <TR key={field.field}>
                      <TD>{field.field}</TD>
                      <TD className="text-right">{field.missing}</TD>
                    </TR>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <p className="text-sm text-ink-muted">
                Every record carries its name, contact, and country.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Duplicate review queue</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4 text-sm text-ink-muted">
            <p>
              Detection writes suspected pairs only — a score never merges anything. Every merge
              needs a named HQ user and writes a reversible audit record.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <dt className="text-ink-subtle">Suspected</dt>
                <dd className="font-medium text-ink">{duplicates.suspectedPairs}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Confirmed, not merged</dt>
                <dd className="font-medium text-ink">{duplicates.confirmedDuplicates}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Dismissed as different people</dt>
                <dd className="font-medium text-ink">{duplicates.dismissed}</dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Merged</dt>
                <dd className="font-medium text-ink">{duplicates.mergedPairs}</dd>
              </div>
            </dl>
            <p className="mt-3">
              <ButtonLink href="/hq/merge-review" variant="secondary">
                Open merge review
              </ButtonLink>
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Source freshness</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4">
            <DataTable>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH>Last activity</TH>
                </TR>
              </THead>
              <tbody>
                {freshness.map((row) => (
                  <TR key={row.source}>
                    <TD>{row.source}</TD>
                    <TD>
                      <span className="text-ink">{freshnessLabel(row.ageHours)}</span>
                      {row.lastSeenAt ? (
                        <span className="ml-2 text-xs text-ink-subtle">
                          {formatDateTime(row.lastSeenAt)}
                        </span>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          </div>
        </Card>
      </div>

      {/* ---- Staged Zoho candidate import -------------------------------- */}
      <section aria-labelledby="candidate-import" className="mt-8">
        <h2 id="candidate-import" className="mb-3 text-sm font-semibold text-ink">
          Zoho candidate import
        </h2>

        {imports.gatesBlocked.length > 0 ? (
          <Alert tone="neutral" title="Candidate import is gated off">
            {imports.gatesBlocked.join("; ")}. Batches run in stages — inventory, map, dry run,
            quarantine, match, human review — and nothing reaches a canonical candidate record until
            the write gate is on and every ambiguous match has been resolved by a person.
          </Alert>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Batches (recent)" value={imports.batches} tone="neutral" />
          <StatCard label="Records processed" value={imports.recordsProcessed} tone="info" />
          <StatCard
            label="Quarantined"
            value={imports.recordsQuarantined}
            hint="Held back with a stated reason — never silently dropped"
            tone={imports.recordsQuarantined === 0 ? "success" : "warn"}
          />
          <StatCard
            label="Awaiting human review"
            value={imports.recordsAwaitingReview}
            tone={imports.recordsAwaitingReview === 0 ? "success" : "orange"}
          />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Latest batch</CardTitle>
          </CardHeader>
          <p className="px-4 pb-4 text-sm text-ink-muted">
            {imports.lastBatchAt
              ? `${imports.lastBatchStage} · ${imports.lastBatchStatus} · started ${formatDateTime(imports.lastBatchAt)}`
              : "No candidate import batch has been created yet."}
          </p>
          <div className="px-4 pb-4">
            <ButtonLink href="/hq/data-quality/imports" variant="secondary">
              Manage import batches
            </ButtonLink>
          </div>
        </Card>
      </section>

      {/* ---- Zoho satellite health --------------------------------------- */}
      <section aria-labelledby="zoho-satellite" className="mt-8">
        <h2 id="zoho-satellite" className="mb-3 text-sm font-semibold text-ink">
          Zoho satellite health
        </h2>

        <Alert tone="info">
          Connection identifiers are masked on the integrations screen, and provider secrets are
          never returned to the browser.
        </Alert>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Open mapping conflicts" value={dq.openConflictCount} tone="warn" />
          <StatCard label="Outbox backlog" value={dq.pendingOutboxCount} tone="info" />
          <StatCard
            label="Oldest pending age (s)"
            value={dq.oldestPendingAgeSeconds ?? "—"}
            tone="neutral"
          />
          <StatCard label="Dead letters" value={dq.deadLetterCount} tone="danger" />
          <StatCard label="Stale Zoho signals" value={dq.staleZohoRecords} tone="warn" />
          <StatCard label="Credential expiry" value={dq.credentialExpiryIndicator} tone="neutral" />
          <StatCard label="Connection status" value={dq.connectionStatus ?? "—"} tone="brand" />
          <StatCard
            label="Sync paused"
            value={dq.syncPausedAt ? "Yes" : "No"}
            tone={dq.syncPausedAt ? "warn" : "success"}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Conflicting external mappings</CardTitle>
            </CardHeader>
            <p className="px-4 pb-4 text-sm text-ink-muted">
              {dq.openConflictCount === 0
                ? "No open Zoho mapping conflicts."
                : `${dq.openConflictCount} open conflict(s). Resolve via Integrations reconcile / conflict tools — payloads stay server-side.`}
            </p>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Last reconciliation</CardTitle>
            </CardHeader>
            <p className="px-4 pb-4 text-sm text-ink-muted">
              {dq.lastReconciliation
                ? `${dq.lastReconciliation.status} · checked ${dq.lastReconciliation.recordsChecked} · differences ${dq.lastReconciliation.differencesFound}`
                : "No reconciliation run recorded yet."}
            </p>
          </Card>
        </div>
      </section>

      <p className="mt-6 text-xs text-ink-subtle">
        Generated {formatDateTime(metrics.generatedAt)}.
      </p>
    </div>
  );
}
