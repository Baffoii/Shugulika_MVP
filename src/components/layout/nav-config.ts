import type { Portal } from "@/lib/constants";
import {
  LayoutDashboard,
  User,
  Briefcase,
  Bookmark,
  CalendarClock,
  ClipboardList,
  Bell,
  Settings,
  Users,
  GitBranch,
  Building2,
  Send,
  BadgeDollarSign,
  BarChart3,
  Globe2,
  Store,
  ShieldCheck,
  Plug,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** true when the destination is a clearly-labelled placeholder module. */
  placeholder?: boolean;
}

export const PORTAL_META: Record<Portal, { label: string; subtitle: string }> = {
  candidate: { label: "Candidate", subtitle: "Candidate" },
  recruiter: { label: "Recruiter", subtitle: "Recruiter" },
  employer: { label: "Employer", subtitle: "Employer" },
  franchise: { label: "Franchise", subtitle: "Franchise" },
  hq: { label: "HQ", subtitle: "HQ" },
};

export const PORTAL_NAV: Record<Portal, NavItem[]> = {
  candidate: [
    { href: "/candidate/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/candidate/profile", label: "Profile", icon: User },
    { href: "/candidate/jobs", label: "Browse jobs", icon: Briefcase },
    { href: "/candidate/saved-jobs", label: "Saved jobs", icon: Bookmark },
    { href: "/candidate/applications", label: "Applications", icon: ClipboardList },
    { href: "/candidate/interviews", label: "Interviews", icon: CalendarClock },
    { href: "/candidate/assessments", label: "Assessments", icon: ShieldCheck, placeholder: true },
    { href: "/candidate/notifications", label: "Notifications", icon: Bell },
    { href: "/candidate/settings", label: "Settings", icon: Settings },
  ],
  recruiter: [
    { href: "/recruiter/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/recruiter/jobs", label: "Jobs & orders", icon: Briefcase },
    { href: "/recruiter/pipeline", label: "Pipeline", icon: GitBranch },
    { href: "/recruiter/candidates", label: "Candidates", icon: Users },
    { href: "/recruiter/clients", label: "Clients", icon: Building2 },
    { href: "/recruiter/interviews", label: "Interviews", icon: CalendarClock },
    { href: "/recruiter/interview-templates", label: "Interview templates", icon: ClipboardList },
    { href: "/recruiter/reports", label: "Reports", icon: BarChart3 },
    { href: "/recruiter/settings", label: "Settings", icon: Settings },
  ],
  employer: [
    { href: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/employer/company", label: "Company", icon: Building2 },
    { href: "/employer/job-orders", label: "Job orders", icon: Briefcase },
    { href: "/employer/submissions", label: "Submissions", icon: Send },
    { href: "/employer/offers", label: "Offers", icon: ClipboardList },
    { href: "/employer/billing", label: "Billing", icon: BadgeDollarSign },
    { href: "/employer/settings", label: "Settings", icon: Settings },
  ],
  franchise: [
    { href: "/franchise/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/franchise/recruiters", label: "Recruiters", icon: Users },
    { href: "/franchise/employers", label: "Employers", icon: Store },
    { href: "/franchise/jobs", label: "Jobs", icon: Briefcase },
    { href: "/franchise/candidates", label: "Candidates", icon: User },
    { href: "/franchise/placements", label: "Placements", icon: BadgeDollarSign },
    { href: "/franchise/billing", label: "Billing", icon: ScrollText },
    { href: "/franchise/reports", label: "Reports", icon: BarChart3 },
    { href: "/franchise/settings", label: "Settings", icon: Settings },
  ],
  hq: [
    { href: "/hq/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/hq/countries", label: "Countries", icon: Globe2 },
    { href: "/hq/franchises", label: "Franchises", icon: Store },
    { href: "/hq/users", label: "Users & roles", icon: Users },
    { href: "/hq/jobs", label: "Jobs", icon: Briefcase },
    { href: "/hq/candidates", label: "Candidates", icon: User },
    { href: "/hq/placements", label: "Placements", icon: BadgeDollarSign },
    { href: "/hq/billing", label: "Billing", icon: ScrollText },
    { href: "/hq/audit-log", label: "Audit log", icon: ShieldCheck },
    { href: "/hq/integrations", label: "Integrations", icon: Plug, placeholder: true },
    { href: "/hq/settings", label: "Settings", icon: Settings },
  ],
};
