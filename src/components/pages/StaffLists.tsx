import { PageHeader, EmptyState } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getJobOrders,
  getJobOrderAudits,
  getJobOwnerAssignments,
  listRecruitersForOrgs,
  getInvoices,
  getPlacements,
  getOrganizations,
} from "@/lib/data/staff";
import { formatDate, formatDateTime, formatMoney, titleCase } from "@/lib/format";
import { PublishJobButton } from "@/components/jobs/PublishJobButton";
import { DenyJobOrderButton } from "@/components/jobs/DenyJobOrderButton";
import { WithdrawJobOrderButton } from "@/components/jobs/WithdrawJobOrderButton";
import { AssignJobRecruiterControl } from "@/components/jobs/AssignJobRecruiterControl";
import { JobOrderListRow } from "@/components/jobs/JobOrderDetails";

const WITHDRAWABLE_STATUSES = new Set(["submitted", "approved", "active", "on_hold"]);
const ASSIGNABLE_STATUSES = new Set(["approved", "active", "on_hold"]);

export async function JobOrdersPage({
  title,
  description,
  canPublish = false,
  canDeny = false,
  canWithdraw = false,
  canAssignRecruiter = false,
  beforeList,
}: {
  title: string;
  description?: string;
  canPublish?: boolean;
  /** HQ / franchise admin denial with mandatory reason. */
  canDeny?: boolean;
  canWithdraw?: boolean;
  canAssignRecruiter?: boolean;
  beforeList?: React.ReactNode;
}) {
  const jobs = await getJobOrders();
  const jobIds = jobs.map((job) => job.id);
  const [audits, owners, recruiters] = await Promise.all([
    getJobOrderAudits(jobIds),
    canAssignRecruiter ? getJobOwnerAssignments(jobIds) : Promise.resolve([]),
    canAssignRecruiter
      ? listRecruitersForOrgs([...new Set(jobs.map((job) => job.responsible_org_id))])
      : Promise.resolve([]),
  ]);
  const auditsByOrder = new Map<string, typeof audits>();
  for (const audit of audits) {
    if (!audit.entity_id) continue;
    const entries = auditsByOrder.get(audit.entity_id) ?? [];
    entries.push(audit);
    auditsByOrder.set(audit.entity_id, entries);
  }
  const ownerByJob = new Map(owners.map((owner) => [owner.job_order_id, owner]));

  return (
    <div>
      <PageHeader title={title} description={description} />
      {beforeList}
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
              <TH>Workflow</TH>
            </TR>
          </THead>
          <tbody>
            {jobs.map((j) => {
              const owner = ownerByJob.get(j.id);
              return (
                <JobOrderListRow
                  key={j.id}
                  job={j}
                  workflow={
                    <>
                      <div className="flex flex-wrap items-start gap-2">
                        {canPublish && j.status === "submitted" ? (
                          <PublishJobButton jobOrderId={j.id} />
                        ) : null}
                        {canDeny && j.status === "submitted" ? (
                          <DenyJobOrderButton jobOrderId={j.id} jobTitle={j.title} />
                        ) : null}
                        {canWithdraw && WITHDRAWABLE_STATUSES.has(j.status) ? (
                          <WithdrawJobOrderButton jobOrderId={j.id} jobTitle={j.title} />
                        ) : null}
                      </div>
                      {j.status === "denied" && j.denial_reason ? (
                        <p className="mt-2 max-w-xs text-xs text-status-danger">
                          Denied: {j.denial_reason}
                        </p>
                      ) : null}
                      {canAssignRecruiter && ASSIGNABLE_STATUSES.has(j.status) ? (
                        <div className="mt-2">
                          <AssignJobRecruiterControl
                            jobOrderId={j.id}
                            responsibleOrgId={j.responsible_org_id}
                            currentRecruiterId={owner?.recruiter_user_id}
                            currentRecruiterName={owner?.recruiter_name}
                            recruiters={recruiters}
                          />
                        </div>
                      ) : null}
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer font-medium text-brand-700">
                          Audit history ({auditsByOrder.get(j.id)?.length ?? 0})
                        </summary>
                        <ol className="mt-2 space-y-2 text-ink-muted">
                          {(auditsByOrder.get(j.id) ?? []).map((audit) => (
                            <li key={audit.id}>
                              <span className="font-medium text-ink">
                                {titleCase(audit.action)}
                              </span>
                              <br />
                              by {audit.actor_name} · {formatDateTime(audit.created_at)}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </>
                  }
                />
              );
            })}
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
