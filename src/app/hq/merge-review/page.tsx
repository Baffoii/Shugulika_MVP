import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  StatCard,
} from "@/components/ui/primitives";
import { DataTable, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { countDuplicatesByStatus, listSuspectedDuplicates } from "@/lib/candidates/duplicate-store";
import { listMergeHistory } from "@/lib/candidates/merge-store";
import { MERGE_STATUS_MESSAGES } from "@/app/hq/merge-review/messages";
import { RevertMergeForm } from "@/app/hq/merge-review/RevertMergeForm";

export const metadata: Metadata = { title: "Merge review" };
export const dynamic = "force-dynamic";

/** Names for the queue, so a reviewer sees people rather than uuids. */
async function displayNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_profiles")
    .select("id,given_name,family_name")
    .in("id", ids);

  const rows =
    (data as { id: string; given_name: string | null; family_name: string | null }[] | null) ?? [];
  return new Map(
    rows.map((r) => [
      r.id,
      [r.given_name, r.family_name].filter(Boolean).join(" ") || "Unnamed record",
    ]),
  );
}

export default async function MergeReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePortal("hq");
  const params = await searchParams;
  const statusCode = Array.isArray(params.merge) ? params.merge[0] : params.merge;
  const detail = Array.isArray(params.detail) ? params.detail[0] : params.detail;
  const status = statusCode ? MERGE_STATUS_MESSAGES[statusCode] : undefined;

  const supabase = createClient();
  const [pairs, counts, history] = await Promise.all([
    listSuspectedDuplicates(supabase, 100),
    countDuplicatesByStatus(supabase),
    listMergeHistory(supabase, 25),
  ]);

  const names = await displayNames([
    ...new Set([
      ...pairs.flatMap((p) => [p.candidateIdLow, p.candidateIdHigh]),
      ...history.flatMap((h) => [h.primaryCandidateId, h.mergedCandidateId]),
    ]),
  ]);

  return (
    <div>
      <PageHeader
        title="Merge review"
        description="Suspected duplicate candidate records. Detection never merges anything — every merge below was chosen by a person, is recorded against them, and can be reversed."
        actions={
          <ButtonLink href="/hq/data-quality" variant="secondary">
            Data quality
          </ButtonLink>
        }
      />

      {status ? (
        <div className="mb-4">
          <Alert tone={status.tone} title={status.title}>
            {detail ? detail : status.text}
          </Alert>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Awaiting review"
          value={counts.suspected}
          tone={counts.suspected === 0 ? "success" : "warn"}
        />
        <StatCard label="Confirmed, not merged" value={counts.confirmed_duplicate} tone="orange" />
        <StatCard label="Dismissed as different" value={counts.not_duplicate} tone="neutral" />
        <StatCard label="Merged" value={counts.merged} tone="info" />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Suspected pairs</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          {pairs.length === 0 ? (
            <EmptyState
              title="Nothing waiting"
              description="No suspected duplicate pairs. Detection runs against the candidate pool and writes pairs here for review."
            />
          ) : (
            <DataTable>
              <THead>
                <TR>
                  <TH>Records</TH>
                  <TH>Match</TH>
                  <TH>Signals</TH>
                  <TH>Detected</TH>
                  <TH />
                </TR>
              </THead>
              <tbody>
                {pairs.map((pair) => (
                  <TR key={pair.id}>
                    <TD>
                      <span className="font-medium text-ink">
                        {names.get(pair.candidateIdLow) ?? pair.candidateIdLow}
                      </span>
                      <span className="mx-2 text-ink-subtle">vs</span>
                      <span className="font-medium text-ink">
                        {names.get(pair.candidateIdHigh) ?? pair.candidateIdHigh}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={pair.matchKind === "exact" ? "danger" : "warn"}>
                        {pair.matchKind === "exact" ? "Exact identifier" : "Probabilistic"}
                      </Badge>
                      <span className="ml-2 text-xs text-ink-subtle">
                        {Math.round(pair.score * 100)}%
                      </span>
                    </TD>
                    <TD>
                      <span className="text-xs text-ink-muted">
                        {pair.signals
                          .filter((s) => s.exact || s.similarity > 0.5)
                          .map((s) => s.key)
                          .join(", ") || "—"}
                      </span>
                    </TD>
                    <TD className="text-xs text-ink-subtle">{formatDateTime(pair.detectedAt)}</TD>
                    <TD className="text-right">
                      <Link
                        className="text-sm text-brand-700 underline"
                        href={`/hq/merge-review/${pair.id}`}
                      >
                        Compare
                      </Link>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Merge history</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          {history.length === 0 ? (
            <p className="text-sm text-ink-muted">No merge has been performed yet.</p>
          ) : (
            <DataTable>
              <THead>
                <TR>
                  <TH>Merged away</TH>
                  <TH>Into</TH>
                  <TH>Fields decided</TH>
                  <TH>When</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <tbody>
                {history.map((event) => (
                  <TR key={event.id}>
                    <TD>{names.get(event.mergedCandidateId) ?? event.mergedCandidateId}</TD>
                    <TD>{names.get(event.primaryCandidateId) ?? event.primaryCandidateId}</TD>
                    <TD>{event.decidedFieldCount}</TD>
                    <TD className="text-xs text-ink-subtle">{formatDateTime(event.performedAt)}</TD>
                    <TD>
                      <Badge tone={event.status === "merged" ? "info" : "neutral"}>
                        {event.status === "merged" ? "Merged" : "Reverted"}
                      </Badge>
                      {event.revertReason ? (
                        <p className="mt-1 text-xs text-ink-subtle">{event.revertReason}</p>
                      ) : null}
                    </TD>
                    <TD className="text-right">
                      {event.status === "merged" ? (
                        <RevertMergeForm mergeEventId={event.id} />
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      </Card>
    </div>
  );
}
