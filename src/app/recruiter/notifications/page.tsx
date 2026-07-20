import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/primitives";
import { MarkNotificationsRead } from "@/components/notifications/MarkNotificationsRead";
import { getMyNotifications } from "@/lib/data/recruiter";
import { formatDateTime, titleCase } from "@/lib/format";
import { Bell } from "lucide-react";

export const metadata: Metadata = { title: "Notifications" };

function notificationHref(subjectType: string | null, subjectId: string | null): string | null {
  if (!subjectType || !subjectId) return null;
  if (subjectType === "application") return `/recruiter/applications/${subjectId}`;
  if (subjectType === "interview_assignment") return `/recruiter/interviews/${subjectId}`;
  return null;
}

export default async function RecruiterNotificationsPage() {
  const notifications = await getMyNotifications();
  return (
    <div>
      <MarkNotificationsRead />
      <PageHeader
        title="Notifications"
        description="New applications and video interview submissions for your pipeline."
      />
      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-8 w-8" />}
          title="No notifications yet"
          description="You'll be notified when candidates apply or submit video interviews."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-surface-border">
            {notifications.map((n) => {
              const href = notificationHref(n.subject_type, n.subject_id);
              const content = (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    <Badge tone={n.category === "interview" ? "brand" : "info"}>
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
