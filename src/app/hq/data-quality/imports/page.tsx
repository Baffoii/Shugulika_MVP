import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import {
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import { DataTable, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { listRecentBatches } from "@/lib/integrations/zoho-recruit/import/store";
import { createZohoImportBatchAction } from "@/app/hq/data-quality/imports/actions";

export const metadata: Metadata = { title: "Zoho candidate imports" };
export const dynamic = "force-dynamic";

export default async function ZohoCandidateImportsPage() {
  await requirePortal("hq");
  const batches = await listRecentBatches(50);

  return (
    <div>
      <PageHeader
        title="Zoho candidate imports"
        description="Create a staged batch, inspect every hold, and record named review decisions before canonical writes."
        actions={
          <ButtonLink href="/hq/data-quality" variant="secondary">
            Data quality
          </ButtonLink>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>New batch</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={createZohoImportBatchAction} className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-ink-muted">
              Mode
              <select
                name="mode"
                defaultValue="dry_run"
                className="mt-1 block rounded-md border border-line bg-white px-3 py-2 text-ink"
              >
                <option value="dry_run">Dry run</option>
                <option value="live">Live (still requires the database write gate)</option>
              </select>
            </label>
            <Button type="submit">Create batch</Button>
          </form>
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recent batches</CardTitle>
        </CardHeader>
        <DataTable>
          <THead>
            <TR>
              <TH>Created</TH>
              <TH>Mode</TH>
              <TH>Stage</TH>
              <TH>Status</TH>
              <TH>Open</TH>
            </TR>
          </THead>
          <tbody>
            {batches.map((batch) => (
              <TR key={batch.id}>
                <TD>{formatDateTime(batch.created_at)}</TD>
                <TD>{batch.is_dry_run ? "Dry run" : "Live"}</TD>
                <TD>{batch.stage}</TD>
                <TD>{batch.status}</TD>
                <TD>
                  <ButtonLink
                    href={`${"/hq/data-quality/imports"}/${batch.id}`}
                    variant="secondary"
                  >
                    Review
                  </ButtonLink>
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </div>
  );
}
