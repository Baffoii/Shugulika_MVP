import type { Metadata } from "next";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Alert,
  Badge,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { getAiUsageSummary, formatUsd, purposeLabel } from "@/lib/data/ai-usage";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "AI credits" };

export default async function HqAiUsagePage() {
  const summary = await getAiUsageSummary();
  const { totals, byPurpose, events, activity, prepaidBalanceUsd, estimatedRemainingUsd } = summary;

  return (
    <div>
      <PageHeader
        title="AI credits & usage"
        description="Estimated OpenAI spend from Shugulika CV features, broken down by what was billed. Official invoice totals live on the OpenAI dashboard."
      />

      <div className="mb-4 space-y-3">
        <Alert tone="info">
          In-app estimates use published gpt-4.1-mini list rates and may differ slightly from your
          OpenAI invoice. For exact credit balance and invoices, open{" "}
          <a
            href={summary.openaiUsageUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            platform.openai.com/usage
          </a>{" "}
          or{" "}
          <a
            href={summary.openaiBillingUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            billing overview
          </a>
          .
        </Alert>
        {prepaidBalanceUsd == null ? (
          <Alert tone="neutral">
            Optional: set <code className="text-xs">OPENAI_PREPAID_BALANCE_USD</code> in the server
            environment to show estimated remaining prepaid credits here.
          </Alert>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Estimated spend" value={formatUsd(totals.estimatedUsd)} tone="brand" />
        <StatCard label="OpenAI API calls" value={totals.callCount} tone="info" />
        <StatCard label="Tokens used" value={totals.totalTokens.toLocaleString()} tone="neutral" />
        <StatCard
          label={prepaidBalanceUsd != null ? "Est. remaining" : "Prepaid balance"}
          value={prepaidBalanceUsd != null ? formatUsd(estimatedRemainingUsd) : "Not configured"}
          tone={prepaidBalanceUsd != null ? "success" : "warn"}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Succeeded CV screens" value={activity.succeededScreens} tone="neutral" />
        <StatCard label="Failed CV screens" value={activity.failedScreens} tone="warn" />
        <StatCard label="OpenAI CV parses" value={activity.openaiResumeParses} tone="neutral" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend by feature</CardTitle>
          </CardHeader>
          {byPurpose.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No metered OpenAI calls yet"
                description="After the usage ledger migration is applied, each CV parse, summary draft, and role-fit screen will appear here with token counts."
              />
            </div>
          ) : (
            <DataTable className="border-0 shadow-none">
              <THead>
                <TR>
                  <TH>What</TH>
                  <TH>Calls</TH>
                  <TH>Tokens</TH>
                  <TH>Est. USD</TH>
                </TR>
              </THead>
              <tbody>
                {byPurpose.map((row) => (
                  <TR key={row.purpose}>
                    <TD className="font-medium text-ink">{row.label}</TD>
                    <TD className="text-ink-muted">{row.callCount}</TD>
                    <TD className="text-ink-muted">{row.totalTokens.toLocaleString()}</TD>
                    <TD className="text-ink-muted">{formatUsd(row.estimatedUsd)}</TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Token mix</CardTitle>
          </CardHeader>
          <div className="space-y-3 p-5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Prompt (input) tokens</span>
              <span className="font-medium text-ink">{totals.promptTokens.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-ink-muted">Completion (output) tokens</span>
              <span className="font-medium text-ink">
                {totals.completionTokens.toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-ink-subtle">
              Tracked features: CV field extraction, professional summary/headline drafts (only when
              a CV has no summary), and recruiter application role-fit screens.
            </p>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent OpenAI calls</CardTitle>
          </CardHeader>
          {events.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No call history"
                description="New paid OpenAI calls will list here with model, purpose, tokens, and estimated cost."
              />
            </div>
          ) : (
            <DataTable className="border-0 shadow-none">
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Feature</TH>
                  <TH>Purpose</TH>
                  <TH>Model</TH>
                  <TH>Tokens</TH>
                  <TH>Est. USD</TH>
                </TR>
              </THead>
              <tbody>
                {events.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {formatDateTime(e.created_at)}
                    </TD>
                    <TD>
                      <Badge tone="neutral">{e.feature}</Badge>
                    </TD>
                    <TD className="text-ink-muted">{purposeLabel(e.purpose)}</TD>
                    <TD className="text-ink-subtle">{e.model}</TD>
                    <TD className="text-ink-muted">{(e.total_tokens ?? 0).toLocaleString()}</TD>
                    <TD className="text-ink-muted">
                      {formatUsd(e.estimated_usd != null ? Number(e.estimated_usd) : null)}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </div>
  );
}
