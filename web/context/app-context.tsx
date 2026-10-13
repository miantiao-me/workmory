import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocalStorage } from "usehooks-ts";
import { useAppearancePreferences } from "../hooks/use-appearance-preferences";
import { createWorkmoryApi } from "../lib/api/client";
import type { ProjectDirectoryEntry } from "../lib/api/types";
import { type Locale, type Theme } from "../lib/preferences";
import { errorMessage, isCredentialRejection, RequestGeneration } from "../lib/presentation";

type AuthState = "checking" | "authenticated" | "unauthenticated" | "verification-error";
type NoticeKind = "success" | "error" | "info";

interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

interface AppContextValue {
  api: ReturnType<typeof createWorkmoryApi>;
  hasApiKey: boolean;
  authState: AuthState;
  login: (key: string) => Promise<void>;
  retryVerification: () => Promise<void>;
  logout: () => void;
  handleApiError: (error: unknown) => void;
  defaultProject: string;
  setDefaultProject: (value: string) => void;
  defaultNamespace: string;
  setDefaultNamespace: (value: string) => void;
  projectDirectory: ProjectDirectoryEntry[];
  projectDirectoryLoading: boolean;
  projectDirectoryError: string;
  refreshProjectDirectory: () => Promise<void>;
  theme: Theme;
  setTheme: (value: Theme) => void;
  locale: Locale;
  setLocale: (value: Locale) => void;
  notify: (message: string, kind?: NoticeKind) => void;
  notices: Notice[];
  dismissNotice: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey, removeApiKey] = useLocalStorage("workmory.api-key", "", { initializeWithValue: true });
  const [defaultProject, setDefaultProject] = useLocalStorage("workmory.default-project", "default");
  const [defaultNamespace, setDefaultNamespace] = useLocalStorage("workmory.default-namespace", "default");
  const { theme, setTheme, locale, setLocale } = useAppearancePreferences();
  const [authState, setAuthState] = useState<AuthState>(apiKey ? "checking" : "unauthenticated");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [projectDirectory, setProjectDirectory] = useState<ProjectDirectoryEntry[]>([]);
  const [projectDirectoryLoading, setProjectDirectoryLoading] = useState(false);
  const [projectDirectoryError, setProjectDirectoryError] = useState("");
  const authRequests = useRef(new RequestGeneration());
  const projectDirectoryRequests = useRef(new RequestGeneration());
  const verifiedKey = useRef<string | undefined>(undefined);

  const api = useMemo(() => createWorkmoryApi({ getApiKey: () => apiKey || undefined }), [apiKey]);

  const clearProjectDirectory = useCallback(() => {
    projectDirectoryRequests.current.invalidate();
    setProjectDirectory([]);
    setProjectDirectoryLoading(false);
    setProjectDirectoryError("");
  }, []);

  const logout = useCallback(() => {
    authRequests.current.invalidate();
    clearProjectDirectory();
    verifiedKey.current = undefined;
    removeApiKey();
    setAuthState("unauthenticated");
  }, [clearProjectDirectory, removeApiKey]);

  const handleApiError = useCallback((error: unknown) => {
    if (isCredentialRejection(error)) logout();
  }, [logout]);

  const verify = useCallback(async (key: string, persist: boolean, announce = true): Promise<void> => {
    const token = authRequests.current.issue();
    if (announce) setAuthState("checking");
    const verifier = createWorkmoryApi({ getApiKey: () => key });
    try {
      await verifier.maintenanceStatus();
      if (!authRequests.current.isCurrent(token)) return;
      if (persist) {
        verifiedKey.current = key;
        setApiKey(key);
      }
      setAuthState("authenticated");
    } catch (error) {
      if (!authRequests.current.isCurrent(token)) return;
      if (isCredentialRejection(error)) {
        removeApiKey();
        setAuthState("unauthenticated");
      } else {
        setAuthState("verification-error");
      }
      throw error;
    }
  }, [removeApiKey, setApiKey]);

  const login = useCallback(async (key: string) => {
    const cleanKey = key.trim();
    // 手动提交不切到全屏 checking，避免登录表单被卸载导致输入状态丢失
    await verify(cleanKey, true, false);
  }, [verify]);

  const retryVerification = useCallback(async () => {
    if (!apiKey) {
      setAuthState("unauthenticated");
      return;
    }
    await verify(apiKey, false);
  }, [apiKey, verify]);

  useEffect(() => {
    if (!apiKey) {
      authRequests.current.invalidate();
      setAuthState("unauthenticated");
      return;
    }
    if (verifiedKey.current === apiKey) {
      verifiedKey.current = undefined;
      return;
    }
    void verify(apiKey, false, true).catch(() => undefined);
  }, [apiKey, verify]);

  const refreshProjectDirectory = useCallback(async () => {
    if (authState !== "authenticated") return;
    const token = projectDirectoryRequests.current.issue();
    setProjectDirectoryLoading(true);
    setProjectDirectoryError("");
    try {
      const result = await api.listProjects();
      if (!projectDirectoryRequests.current.isCurrent(token)) return;
      setProjectDirectory(result.projects);
    } catch (error) {
      if (!projectDirectoryRequests.current.isCurrent(token)) return;
      handleApiError(error);
      if (!isCredentialRejection(error) && projectDirectoryRequests.current.isCurrent(token)) {
        setProjectDirectoryError(errorMessage(error));
      }
    } finally {
      if (projectDirectoryRequests.current.isCurrent(token)) setProjectDirectoryLoading(false);
    }
  }, [api, authState, handleApiError]);

  useEffect(() => {
    if (authState !== "authenticated") {
      clearProjectDirectory();
      return;
    }
    void refreshProjectDirectory();
    return () => projectDirectoryRequests.current.invalidate();
  }, [authState, clearProjectDirectory, refreshProjectDirectory]);

  const dismissNotice = useCallback((id: number) => setNotices((items) => items.filter((item) => item.id !== id)), []);
  const notify = useCallback((message: string, kind: NoticeKind = "success") => {
    const id = Date.now() + Math.random();
    setNotices((items) => [...items.slice(-2), { id, kind, message }]);
    window.setTimeout(() => dismissNotice(id), 4200);
  }, [dismissNotice]);

  const value = useMemo<AppContextValue>(() => ({
    api, hasApiKey: Boolean(apiKey), authState, login, retryVerification, logout, handleApiError,
    defaultProject, setDefaultProject, defaultNamespace, setDefaultNamespace,
    projectDirectory, projectDirectoryLoading, projectDirectoryError, refreshProjectDirectory,
    theme, setTheme, locale, setLocale, notify, notices, dismissNotice,
  }), [api, apiKey, authState, defaultNamespace, defaultProject, dismissNotice, handleApiError, locale, login, logout, notices, notify, projectDirectory, projectDirectoryError, projectDirectoryLoading, refreshProjectDirectory, retryVerification, setDefaultNamespace, setDefaultProject, setLocale, setTheme, theme]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
