import type { Location } from "react-router-dom";

export interface SettingsRouteState {
  backgroundLocation?: Location;
}

export interface SettingsBackground {
  location: Location;
  hasHistoryEntry: boolean;
}

const dashboardLocation: Location = {
  hash: "",
  key: "settings-dashboard",
  pathname: "/",
  search: "",
  state: null,
};

export function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function readSettingsBackground(location: Location): SettingsBackground {
  const state = location.state as SettingsRouteState | null;
  const backgroundLocation = state?.backgroundLocation;

  if (
    backgroundLocation &&
    typeof backgroundLocation.pathname === "string" &&
    backgroundLocation.pathname.startsWith("/") &&
    !isSettingsPath(backgroundLocation.pathname)
  ) {
    return { hasHistoryEntry: true, location: backgroundLocation };
  }

  return { hasHistoryEntry: false, location: dashboardLocation };
}
