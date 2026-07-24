import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { ReviewPanel } from "@/components/employer-applications/ReviewPanel";
import {
  listEmployerApplicationsForReview,
  getEmployerApplicationForReview,
} from "@/lib/data/employer-applications";
import {
  APPLICATION_EVENT_LABELS,
  applicationStatusLabel,
  parseRequestedChanges,
} from "@/lib/employer-onboarding";
import {
  COUNTRIES,
  EMPLOYER_APPLICATION_STATUSES,
  EMPLOYER_APPLICATION_STATUS_LABELS,
  EMPLOYER_REJECTION_CATEGORIES,
  ORGANIZATION_TYPES,
  type EmployerApplicationStatus,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/format";

export interface QueueSearchParams {
  status?: string;
  country?: string;
}

/**
 * Shared employer-application review queue. Rows are authorization-scoped by
 * RLS before they reach this component: HQ sees every application; a franchise
 * sees only applications assigned to it inside its configured geography.
 */
export async function EmployerApplicationsQueuePage({
  basePath,
  description,
  searchParams,
}: {
  basePath: string;
  description: string;
  searchParams: QueueSearchParams;
}) {
  const status = searchParams.status || undefined;
  const country = searchParams.country || undefined;
  const items = await listEmployerApplicationsForReview({ status, country });

  const awaiting = items.filter((i) => i.status === "submitted" || i.status === "under_review");

  return (
    <div>
      <PageHeader
        title="Employer applications"
        description={description}
        actions={
          <Badge tone={awaiting.length > 0 ? "warn" : "neutral"}>
            {awaiting.length} awaiting decision
          </Badge>
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="status" className="label-base">
            Status
          </label>
          <select id="status" name="status" defaultValue={status ?? ""} className="input-base pr-8">
            <option value="">All statuses</option>
            {EMPLOYER_APPLICATION_STATUSES.filter((s) => s !== "draft").map((s) => (
              <option key={s} value={s}>
                {EMPLOYER_APPLICATION_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="country" className="label-base">
            Country
          </label>
          <select
            id="country"
            name="country"
            defaultValue={country ?? ""}
            className="input-base pr-8"
          >
            <option value="">All countries</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Filter
        </button>
        {status || country ? (
          <Link href={basePath} className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        ) : null}
      </form>

      {items.length === 0 ? (
        <EmptyState
          title="No employer applications"
          description="Applications appear here as soon as employers submit their company registration."
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Company</TH>
              <TH>Geography</TH>
              <TH>Industry</TH>
              <TH>Submitted by</TH>
              <TH>Submitted</TH>
              <TH>Assigned office</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {items.map((item) => (
              <TR key={item.id}>
                <TD>
                  <p className="font-medium">{item.legal_name ?? "—"}</p>
                  {item.duplicate_warning ? (
                    <Badge tone="orange" className="mt-1">
                      Possible duplicate
                    </Badge>
                  ) : null}
                </TD>
                <TD>
                  {[item.country_code, item.region, item.city].filter(Boolean).join(" · ") || "—"}
                </TD>
                <TD>{item.industry ?? "—"}</TD>
                <TD>
                  <p>{item.applicant_name}</p>
                  <p className="text-xs text-ink-subtle">{item.applicant_email}</p>
                </TD>
                <TD>{item.submitted_at ? formatDateTime(item.submitted_at) : "—"}</TD>
                <TD>{item.assigned_org_name}</TD>
                <TD>
                  <StatusBadge status={item.status} label={applicationStatusLabel(item.status)} />
                  {item.version > 1 ? (
                    <p className="mt-1 text-xs text-ink-subtle">v{item.version}</p>
                  ) : null}
                </TD>
                <TD>
                  <Link
                    href={`${basePath}/${item.id}`}
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    Open
                  </Link>
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className="text-right font-medium text-ink">{value || "—"}</dd>
    </div>
  );
}

/** Shared application review view (HQ gets assign/reassign on top). */
export async function EmployerApplicationReviewPage({
  applicationId,
  basePath,
  canReassign,
}: {
  applicationId: string;
  basePath: string;
  canReassign: boolean;
}) {
  const detail = await getEmployerApplicationForReview(applicationId);
  if (!detail) notFound();
  const { application: app, events, eligibleFranchises } = detail;

  const orgType =
    ORGANIZATION_TYPES.find((t) => t.key === app.organization_type)?.label ?? app.organization_type;
  const country = COUNTRIES.find((c) => c.code === app.country_code)?.name ?? app.country_code;
  const rejectionLabel = EMPLOYER_REJECTION_CATEGORIES.find(
    (c) => c.key === app.rejection_category,
  )?.label;
  const requestedChanges = parseRequestedChanges(app.requested_changes);
  const statusLabel =
    EMPLOYER_APPLICATION_STATUS_LABELS[app.status as EmployerApplicationStatus] ?? app.status;

  return (
    <div>
      <div className="mb-4">
        <Link href={basePath} className="text-sm text-brand-700 hover:underline">
          ← All employer applications
        </Link>
      </div>
      <PageHeader
        title={app.legal_name ?? "Employer application"}
        description={`Application version ${app.version} · submitted by ${app.applicant_name} (${app.applicant_email})`}
        actions={<StatusBadge status={app.status} label={statusLabel} />}
      />

      {app.duplicate_warning ? (
        <div className="mb-4">
          <Alert tone="orange" title="Possible duplicate registration">
            <ul className="list-disc pl-5">
              {app.duplicate_reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr,380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Company identity</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="divide-y divide-surface-border/60">
                <DetailRow label="Registered name" value={app.legal_name} />
                <DetailRow label="Trading name" value={app.trading_name} />
                <DetailRow label="Organization type" value={orgType} />
                <DetailRow label="Industry" value={app.industry} />
                <DetailRow label="Company size" value={app.company_size} />
                <DetailRow label="Year established" value={app.year_established} />
                <DetailRow
                  label="Website"
                  value={
                    app.website ? (
                      <a
                        href={app.website}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-brand-700 hover:underline"
                      >
                        {app.website}
                      </a>
                    ) : null
                  }
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Registered address</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="divide-y divide-surface-border/60">
                <DetailRow label="Country" value={country} />
                <DetailRow label="Region" value={app.region} />
                <DetailRow label="City" value={app.city} />
                <DetailRow label="Physical address" value={app.physical_address} />
                <DetailRow label="Postal address" value={app.postal_address} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Primary contact</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="divide-y divide-surface-border/60">
                <DetailRow label="Name" value={app.contact_name} />
                <DetailRow label="Job title" value={app.contact_job_title} />
                <DetailRow label="Work email" value={app.contact_email} />
                <DetailRow label="Phone" value={app.contact_phone} />
                <DetailRow
                  label="Authorized to administer"
                  value={app.contact_is_authorized ? "Confirmed" : "Not confirmed"}
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Routing rationale</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <dl className="divide-y divide-surface-border/60">
                <DetailRow
                  label="Registered geography"
                  value={[app.country_code, app.region].filter(Boolean).join(" · ")}
                />
                <DetailRow
                  label="Employer's routing choice"
                  value={
                    app.routing_mode === "hq"
                      ? "Let Shugulika HQ assign my office"
                      : app.routing_mode === "franchise"
                        ? "Chose a specific office"
                        : "Automatic proposal"
                  }
                />
                <DetailRow label="Current assignment" value={app.assigned_org_name} />
                <DetailRow
                  label="Eligible offices"
                  value={
                    eligibleFranchises.length > 0
                      ? eligibleFranchises.map((f) => f.name).join(", ")
                      : "None — HQ queue"
                  }
                />
              </dl>
              <dl className="divide-y divide-surface-border/60">
                <DetailRow
                  label="Declarations"
                  value={
                    app.declared_accurate && app.declared_authorized && app.accepted_terms
                      ? "All confirmed"
                      : "Incomplete"
                  }
                />
                <DetailRow
                  label="First submitted"
                  value={app.first_submitted_at ? formatDateTime(app.first_submitted_at) : null}
                />
                <DetailRow
                  label="Latest submission"
                  value={app.submitted_at ? formatDateTime(app.submitted_at) : null}
                />
              </dl>
            </CardBody>
          </Card>

          {app.status === "changes_requested" ? (
            <Alert tone="warn" title="Changes requested from the employer">
              <p>{app.changes_requested_message}</p>
              {requestedChanges.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {requestedChanges.map((c, i) => (
                    <li key={i}>
                      {c.field ? <span className="font-medium">{c.field}: </span> : null}
                      {c.instruction}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}

          {app.status === "rejected" ? (
            <Alert tone="danger" title={`Rejected — ${rejectionLabel ?? "no category"}`}>
              <p>{app.rejection_reason}</p>
              <p className="mt-1 text-xs">
                Reapplication {app.reapply_allowed ? "allowed" : "not allowed"}.
              </p>
            </Alert>
          ) : null}

          {app.previous_application_id ? (
            <p className="text-xs text-ink-subtle">
              Revised application —{" "}
              <Link
                href={`${basePath}/${app.previous_application_id}`}
                className="text-brand-700 hover:underline"
              >
                view the previous application
              </Link>
              .
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <ReviewPanel
            applicationId={app.id}
            status={app.status}
            canReassign={canReassign}
            assignedOrgId={app.assigned_org_id}
            eligibleFranchises={eligibleFranchises.map((f) => ({ id: f.id, name: f.name }))}
          />

          <Card>
            <CardHeader>
              <CardTitle>Decision history</CardTitle>
            </CardHeader>
            <CardBody>
              {events.length === 0 ? (
                <p className="text-sm text-ink-muted">No events yet.</p>
              ) : (
                <ol className="space-y-3">
                  {events.map((e) => (
                    <li
                      key={e.id}
                      className="border-b border-surface-border/60 pb-3 text-sm last:border-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-ink">
                          {APPLICATION_EVENT_LABELS[e.action] ?? e.action}
                          {!e.visible_to_employer ? (
                            <Badge tone="neutral" className="ml-2">
                              Internal
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-xs text-ink-subtle">
                          {formatDateTime(e.created_at)}
                        </span>
                      </div>
                      {e.message ? <p className="mt-0.5 text-ink-muted">{e.message}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
