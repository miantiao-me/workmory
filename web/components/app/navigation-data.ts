/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: lib/navigation-data.ts
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: replaced Cal.com navigation items and types with Workmory routes and i18n label keys; moved to components/app/.
 */
import {
  Database,
  Gauge,
  GitFork,
  LayoutDashboard,
  Paperclip,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type NavigationLabelKey =
  | "shell.navigation.overview"
  | "shell.navigation.memories"
  | "shell.navigation.graph"
  | "shell.navigation.profile"
  | "shell.navigation.attachments"
  | "shell.navigation.maintenance"
  | "shell.navigation.settings";

export interface NavigationItem {
  to: string;
  labelKey: NavigationLabelKey;
  icon: LucideIcon;
  end: boolean;
}

export const navMainItems: NavigationItem[] = [
  {
    to: "/",
    labelKey: "shell.navigation.overview",
    icon: LayoutDashboard,
    end: true,
  },
  {
    to: "/memories",
    labelKey: "shell.navigation.memories",
    icon: Database,
    end: false,
  },
  {
    to: "/graph",
    labelKey: "shell.navigation.graph",
    icon: GitFork,
    end: false,
  },
  {
    to: "/profile",
    labelKey: "shell.navigation.profile",
    icon: UserRound,
    end: false,
  },
  {
    to: "/attachments",
    labelKey: "shell.navigation.attachments",
    icon: Paperclip,
    end: false,
  },
  {
    to: "/maintenance",
    labelKey: "shell.navigation.maintenance",
    icon: Gauge,
    end: false,
  },
];

export const navSecondaryItems: NavigationItem[] = [
  {
    to: "/settings",
    labelKey: "shell.navigation.settings",
    icon: Settings,
    end: false,
  },
];

export function isNavigationItemActive(
  pathname: string,
  item: NavigationItem,
): boolean {
  if (item.to === "/") return pathname === "/";
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
