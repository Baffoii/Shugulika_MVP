import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePortal } from "@/lib/auth";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
} from "@/components/ui/primitives";
import { DataTable, TD, TH, THead, TR } from "@/components/ui/table";
import { getImportBatch, listBatchRecords } from "@/lib/integrations/zoho-recruit/import/store";
import {
  advanceZohoImportBatchAction,
  reviewZohoImportRecordAction,
} from "@/app/hq/data-quality/imports/actions";

export const metadata: Metadata = { title: "Candidate import batch" };
export const dynamic = "force-dynamic";

export default async function CandidateImportBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requirePortal("hq");
  const { batchId } = await params;
  const [batch, records] = await Promise.all([getImportBatch(batchId), listBatchRecords(batchId)]);
  if (!batch) notFound();
  const review = records.filter(
    (record) => record.status === "needs_human_review" || record.status === "quarantined",
  );

  return (
    <div>
      <PageHeader
        title="Candidate import batch"
        description={`${batch.is_dry_run ? "Dry run" : "Live"} · ${batch.stage} · ${batch.status}`}
        actions={
          <ButtonLink href="/hq/data-quality/imports" variant="secondary">
            All batches
          </ButtonLink>
        }
      />
      {batch.last_error ? (
        <Alert tone="danger" title="Batch failed">
          {batch.last_error}
        </Alert>
      ) : null}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Advance one stage</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-ink-muted">
            One click advances exactly one stage. Human-review holds and disabled write gates do not
            advance.
          </p>
          <form action={advanceZohoImportBatchAction}>
            <input type="hidden" name="batchId" value={batch.id} />
            <Button
              type="submit"
              disabled={["completed", "cancelled", "failed"].includes(batch.status)}
            >
              Advance
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Records awaiting a decision ({review.length})</CardTitle>
        </CardHeader>
        {review.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-ink-muted">No unresolved records.</p>
        ) : (
          <DataTable>
            <THead>
              <TR>
                <TH>Zoho record</TH>
                <TH>Status</TH>
                <TH>Reasons</TH>
                <TH>Decision</TH>
              </TR>
            </THead>
            <tbody>
              {review.map((record) => (
                <TR key={record.id}>
                  <TD>{record.zoho_record_id}</TD>
                  <TD>{record.status}</TD>
                  <TD>{record.quarantine_reasons.join(", ") || "Ambiguous match"}</TD>
                  <TD>
                    <form action={reviewZohoImportRecordAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="batchId" value={batch.id} />
                      <input type="hidden" name="recordId" value={record.id} />
                      <input
                        name="matchedCandidateId"
                        defaultValue={record.matched_candidate_id ?? ""}
                        aria-label="Existing candidate id"
                        placeholder="Candidate UUID for link"
                        className="w-64 rounded-md border border-line px-2 py-1 text-sm"
                      />
                      <select
                        name="decision"
                        defaultValue="skip"
                        className="rounded-md border border-line bg-white px-2 py-1 text-sm"
                      >
                        <option value="skip">Skip</option>
                        {record.status !== "quarantined" ? (
                          <option value="create_new">Create new</option>
                        ) : null}
                        {record.status !== "quarantined" ? (
                          <option value="link_existing">Link existing</option>
                        ) : null}
                      </select>
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </TD>
                </TR>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </div>
  );
}
