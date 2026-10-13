import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../context/app-context";
import type { MaintenanceStatus } from "../lib/api/types";
import { errorMessage, RequestGeneration } from "../lib/presentation";

export function useMaintenanceStatus() {
  const { api, handleApiError } = useApp();
  const [status, setStatus] = useState<MaintenanceStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requests = useRef(new RequestGeneration());

  const load = useCallback(async () => {
    const token = requests.current.issue();
    setLoading(true);
    setError("");
    try {
      const result = await api.maintenanceStatus();
      if (!requests.current.isCurrent(token)) return;
      setStatus(result);
    } catch (cause) {
      if (!requests.current.isCurrent(token)) return;
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      if (requests.current.isCurrent(token)) setLoading(false);
    }
  }, [api, handleApiError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => requests.current.invalidate(), []);

  return { status, loading, error, load };
}
