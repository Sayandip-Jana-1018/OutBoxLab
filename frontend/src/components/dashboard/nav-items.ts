import {
  LayoutDashboard,
  PenSquare,
  CalendarClock,
  Send,
  Mailbox,
  Settings,
  Megaphone,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", short: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/compose", label: "Compose", short: "Compose", icon: PenSquare },
  { href: "/dashboard/scheduled", label: "Scheduled", short: "Queue", icon: CalendarClock },
  { href: "/dashboard/sent", label: "Sent & history", short: "Sent", icon: Send },
  { href: "/dashboard/campaigns", label: "Campaigns", short: "Campaigns", icon: Megaphone },
  { href: "/dashboard/senders", label: "Mailboxes", short: "Mailboxes", icon: Mailbox },
  { href: "/dashboard/settings", label: "Settings", short: "Settings", icon: Settings },
];

export function isActivePath(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
