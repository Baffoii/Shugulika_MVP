import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/primitives";
import { MarkNotificationsRead } from "@/components/notifications/MarkNotificationsRead";
import { getMyNotifications } from "@/lib/data/recruiter";
import { formatDateTime, titleCase } from "@/lib/format";
import type { Portal } from "@/lib/constants";

function notificationHref(
  portal: Portal,
  subjectType: string | null,
  subjectId: string | null,
): string | null {
  if (!subjectType) return null;
  if (subjectType === "job_order") {
    if (portal === "hq") return "/hq/jobs";
    if (portal === "franchise") return "/franchise/jobs";
    if (portal === "recruiter") return "/recruiter/jobs";
  }
  if (subjectType === "employer_application" && subjectId) {
    if (portal === "hq") return `/hq/employer-applications/${subjectId}`;
    if (portal === "franchise") return `/franchise/employer-applications/${subjectId}`;
  }
  if (subjectType === "application" && subjectId && portal === "recruiter") {
    return `/recruiter/applications/${subjectId}`;
  }
  if (subjectType === "interview_assignment" && subjectId && portal === "recruiter") {
    return `/recruiter/interviews/${subjectId}`;
  }
  return null;
}

export function staffNotificationsMetadata(title = "Notifications"): Metadata {
  return { title };
}

export async function StaffNotificationsInbox({
  portal,
  description,
}: {
  portal: Extract<Portal, "hq" | "franchise" | "recruiter">;
  description: string;
}) {
  const notifications = await getMyNotifications();
  return (
    <div>
      <MarkNotificationsRead />
      <PageHeader title="Notifications" description={description} />
      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-8 w-8" />}
          title="No notifications yet"
          description="You'll be notified when something needs your attention."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-surface-border">
            {notifications.map((n) => {
              const href = notificationHref(portal, n.subject_type, n.subject_id);
              const content = (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    <Badge tone={n.category === "job_order" ? "warn" : "info"}>
                      {titleCase(n.category)}
                    </Badge>
                    {!n.read_at ? <Badge tone="danger">New</Badge> : null}
                  </div>
                  {n.body ? <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p> : null}
                  <p className="mt-1 text-xs text-ink-subtle">{formatDateTime(n.created_at)}</p>
                </>
              );
              return (
                <li key={n.id} className={`px-5 py-3 ${n.read_at ? "" : "bg-brand-50/40"}`}>
                  {href ? (
                    <Link href={href} className="block hover:opacity-90">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
