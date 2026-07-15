import { PortalChrome, type PortalSwitch } from "@/components/layout/PortalChrome";
import { PORTAL_META } from "@/components/layout/nav-config";
import { PORTAL_ROLES, ROLE_HOME, type Portal, type Role } from "@/lib/constants";
import type { SessionContext } from "@/lib/auth";

/** Build the list of portals a user may switch between, from their roles. */
function portalSwitches(roles: Role[]): PortalSwitch[] {
  const portals: Portal[] = ["candidate", "recruiter", "employer", "franchise", "hq"];
  const out: PortalSwitch[] = [];
  for (const p of portals) {
    if (roles.some((r) => PORTAL_ROLES[p].includes(r))) {
      out.push({ portal: p, href: firstHrefForPortal(p, roles), label: PORTAL_META[p].label });
    }
  }
  return out;
}

function firstHrefForPortal(portal: Portal, roles: Role[]): string {
  const r = roles.find((x) => PORTAL_ROLES[portal].includes(x));
  return r ? ROLE_HOME[r] : `/${portal}/dashboard`;
}

export function DashboardShell({
  portal,
  session,
  children,
}: {
  portal: Portal;
  session: SessionContext;
  children: React.ReactNode;
}) {
  const name = session.profile?.full_name ?? session.email;
  return (
    <PortalChrome portal={portal} userName={name} email={session.email} switches={portalSwitches(session.roles)}>
      {children}
    </PortalChrome>
  );
}
