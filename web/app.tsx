import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FullPageLoader, NoticeStack } from "./components/common";
import { SettingsShell } from "./components/settings";
import { AppShell } from "./components/shell";
import { useApp } from "./context/app-context";
import { LoginPage } from "./pages/login";
import { isSettingsPath, readSettingsBackground } from "./lib/settings-route";

const AttachmentsPage = lazy(() => import("./pages/attachments").then((module) => ({ default: module.AttachmentsPage })));
const DashboardPage = lazy(() => import("./pages/dashboard").then((module) => ({ default: module.DashboardPage })));
const GraphPage = lazy(() => import("./pages/graph").then((module) => ({ default: module.GraphPage })));
const MaintenancePage = lazy(() => import("./pages/maintenance").then((module) => ({ default: module.MaintenancePage })));
const MemoriesPage = lazy(() => import("./pages/memories").then((module) => ({ default: module.MemoriesPage })));
const NotFoundPage = lazy(() => import("./pages/not-found").then((module) => ({ default: module.NotFoundPage })));
const ProfilePage = lazy(() => import("./pages/profile").then((module) => ({ default: module.ProfilePage })));
const CredentialsSettingsPage = lazy(() => import("./pages/settings/credentials").then((module) => ({ default: module.CredentialsSettingsPage })));
const AppearanceSettingsPage = lazy(() => import("./pages/settings/appearance").then((module) => ({ default: module.AppearanceSettingsPage })));
const DefaultsSettingsPage = lazy(() => import("./pages/settings/defaults").then((module) => ({ default: module.DefaultsSettingsPage })));

function AuthenticatedRoutes() {
  const { t } = useTranslation();
  const { authState } = useApp();
  const location = useLocation();

  if (authState === "checking") return <FullPageLoader label={t("common.verifyingCredentials")} />;
  if (authState !== "authenticated") return <LoginPage />;

  const settingsOpen = isSettingsPath(location.pathname);
  const background = readSettingsBackground(location);

  return (
    <>
      <Suspense fallback={<FullPageLoader />}>
        <Routes location={settingsOpen ? background.location : location}>
          <Route element={<Navigate replace to="/" />} path="/login" />
          <Route element={<AppShell />}>
            <Route element={<DashboardPage />} index />
            <Route element={<MemoriesPage />} path="memories" />
            <Route element={<GraphPage />} path="graph" />
            <Route element={<ProfilePage />} path="profile" />
            <Route element={<AttachmentsPage />} path="attachments" />
            <Route element={<MaintenancePage />} path="maintenance" />
            <Route element={<NotFoundPage />} path="*" />
          </Route>
        </Routes>
      </Suspense>
      {settingsOpen && (
        <Routes location={location}>
          <Route element={<SettingsShell />} path="settings">
            <Route element={<CredentialsSettingsPage />} index />
            <Route element={<AppearanceSettingsPage />} path="appearance" />
            <Route element={<DefaultsSettingsPage />} path="defaults" />
            <Route
              element={<Navigate replace state={location.state} to="/settings" />}
              path="*"
            />
          </Route>
        </Routes>
      )}
    </>
  );
}

export function App() {
  return (
    <>
      <Suspense fallback={<FullPageLoader />}>
        <AuthenticatedRoutes />
      </Suspense>
      <NoticeStack />
    </>
  );
}
