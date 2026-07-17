import { PageHeader, EmptyState, Badge } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { getJobOrders, getInvoices, getPlacements, getOrganizations } from "@/lib/data/staff";
import { formatDate, formatMoney, titleCase } from "@/lib/format";

export async function JobOrdersPage({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const jobs = await getJobOrders();
  return (
    <div>
      <PageHeader title={title} description={description} />
      {jobs.length === 0 ? (
        <EmptyState
          title="No job orders"
          description="Job orders within your scope will appear here."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Role</TH>
              <TH>Location</TH>
              <TH>Route</TH>
              <TH>Status</TH>
              <TH>Vacancies</TH>
              <TH>Created</TH>
            </TR>
          </THead>
          <tbody>
            {jobs.map((j) => (
              <TR key={j.id}>
                <TD className="font-medium text-ink">{j.title}</TD>
                <TD className="text-ink-muted">
                  {[j.city, j.country_code].filter(Boolean).join(", ")}
                </TD>
                <TD>
                  <Badge tone={j.recruitment_path === "A" ? "info" : "success"}>
                    {j.recruitment_path === "A" ? "Direct" : "Managed"}
                  </Badge>
                </TD>
                <TD>
                  <StatusBadge status={j.status} />
                </TD>
                <TD className="text-ink-muted">{j.vacancy_count}</TD>
                <TD className="text-ink-muted">{formatDate(j.created_at)}</TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}

export async function InvoicesPage({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const invoices = await getInvoices();
  return (
    <div>
      <PageHeader title={title} description={description} />
      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Invoices for packages and placements will appear here. Payments are recorded manually in this MVP."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Invoice</TH>
              <TH>Amount</TH>
              <TH>Status</TH>
              <TH>Payment</TH>
              <TH>Due</TH>
            </TR>
          </THead>
          <tbody>
            {invoices.map((i) => (
              <TR key={i.id}>
                <TD className="font-medium text-ink">{i.invoice_number}</TD>
                <TD className="text-ink-muted">{formatMoney(i.total, i.currency)}</TD>
                <TD>
                  <StatusBadge status={i.status} />
                </TD>
                <TD>
                  <StatusBadge status={i.payment_status} />
                </TD>
                <TD className="text-ink-muted">{formatDate(i.due_date)}</TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}

export async function PlacementsPage({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const placements = await getPlacements();
  return (
    <div>
      <PageHeader title={title} description={description} />
      {placements.length === 0 ? (
        <EmptyState
          title="No placements yet"
          description="Successful hires and their placement details will appear here."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Placement</TH>
              <TH>Fee</TH>
              <TH>Start</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <tbody>
            {placements.map((p) => (
              <TR key={p.id}>
                <TD className="font-medium text-ink">{p.id.slice(0, 8)}</TD>
                <TD className="text-ink-muted">{formatMoney(p.fee, p.currency)}</TD>
                <TD className="text-ink-muted">{formatDate(p.start_date)}</TD>
                <TD>
                  <StatusBadge status={p.status} label={titleCase(p.status)} />
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}

export async function OrgsPage({
  type,
  title,
  description,
}: {
  type: "franchise" | "employer";
  title: string;
  description?: string;
}) {
  const orgs = await getOrganizations(type);
  return (
    <div>
      <PageHeader title={title} description={description} />
      {orgs.length === 0 ? (
        <EmptyState
          title={`No ${type === "franchise" ? "franchises" : "employers"} yet`}
          description="They will appear here once created."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Country</TH>
              <TH>{type === "employer" ? "Industry" : "Territory"}</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <tbody>
            {orgs.map((o) => (
              <TR key={o.id}>
                <TD className="font-medium text-ink">{o.name}</TD>
                <TD className="text-ink-muted">{o.country_code ?? "—"}</TD>
                <TD className="text-ink-muted">{o.industry ?? "—"}</TD>
                <TD>
                  <StatusBadge
                    status={o.verification_status}
                    label={titleCase(o.verification_status)}
                  />
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
