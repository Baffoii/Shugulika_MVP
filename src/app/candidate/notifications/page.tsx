import type { Metadata } from "next";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/primitives";
import { getMyNotifications } from "@/lib/data/candidate";
import { formatDateTime, titleCase } from "@/lib/format";
import { Bell } from "lucide-react";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const notifications = await getMyNotifications();
  return (
    <div>
      <PageHeader title="Notifications" description="Updates about your applications, interviews, and consent requests." />
      {notifications.length === 0 ? (
        <EmptyState icon={<Bell className="h-8 w-8" />} title="No notifications yet" description="We'll let you know when something needs your attention." />
      ) : (
        <Card>
          <ul className="divide-y divide-surface-border">
            {notifications.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 px-5 py-3 ${n.read_at ? "" : "bg-brand-50/40"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    <Badge tone="neutral">{titleCase(n.category)}</Badge>
                  </div>
                  {n.body ? <p className="mt-0.5 text-sm text-ink-muted">{n.body}</p> : null}
                  <p className="mt-1 text-xs text-ink-subtle">{formatDateTime(n.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
