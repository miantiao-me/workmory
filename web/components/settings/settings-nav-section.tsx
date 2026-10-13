"use client";

import type { LucideIcon } from "lucide-react";
import { SettingsIcon } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { matchPath, NavLink, useLocation } from "react-router-dom";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

export interface SettingsNavChild {
  title: string;
  url: string;
  end?: boolean;
}

export interface SettingsNavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
  children: SettingsNavChild[];
}

export interface SettingsNavSectionProps {
  section: SettingsNavItem;
  pathname: string;
  state: unknown;
  onItemClick?: () => void;
}

export function SettingsNavSection({
  section,
  pathname,
  state,
  onItemClick,
}: SettingsNavSectionProps): ReactElement {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>
        {section.icon && <section.icon className="opacity-80" />}
        <span>{section.title}</span>
      </SidebarGroupLabel>
      <SidebarMenuSub className="mx-0 gap-0.5 border-none px-0 md:max-lg:flex">
        {section.children.map((item) => (
          <SidebarMenuSubItem key={item.url}>
            <SidebarMenuSubButton
              className="ps-8.5 sm:ps-8 md:max-lg:flex"
              isActive={Boolean(
                matchPath(
                  { end: item.end ?? false, path: item.url },
                  pathname,
                ),
              )}
              render={
                <NavLink
                  end={item.end}
                  onClick={onItemClick}
                  replace
                  state={state}
                  to={item.url}
                />
              }
            >
              <span className="flex min-w-0 flex-1 items-center gap-1">
                {item.title}
              </span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </SidebarGroup>
  );
}

export interface SettingsNavContentProps {
  onItemClick?: () => void;
}

export function SettingsNavContent({
  onItemClick,
}: SettingsNavContentProps): ReactElement {
  const { pathname, state } = useLocation();
  const { t } = useTranslation();
  const section: SettingsNavItem = {
    children: [
      {
        end: true,
        title: t("settings.tabs.credentials"),
        url: "/settings",
      },
      {
        title: t("settings.tabs.appearance"),
        url: "/settings/appearance",
      },
      {
        title: t("settings.tabs.defaults"),
        url: "/settings/defaults",
      },
    ],
    icon: SettingsIcon,
    title: t("settings.title"),
    url: "/settings",
  };

  return (
    <div className="pb-2">
      <SettingsNavSection
        onItemClick={onItemClick}
        pathname={pathname}
        section={section}
        state={state}
      />
    </div>
  );
}
