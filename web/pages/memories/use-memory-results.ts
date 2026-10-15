import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { useTranslation } from "react-i18next";
import type { MemoryListItem, SearchResult } from "../../../server/domain/memory";
import { useApp } from "../../context/app-context";
import { errorMessage, parseTagsInput, RequestGeneration, stableIdentifier, tagsFromInput, UserFacingError } from "../../lib/presentation";

export interface MemoryRow {
  record: MemoryListItem;
  score?: number;
}

export function useMemoryResults({ project, namespace }: { project: string; namespace: string }) {
  const { t } = useTranslation();
  const { api, handleApiError } = useApp();
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounceValue(query, 450);
  const [semanticWeight, setSemanticWeight] = useState(0.5);
  const [debouncedSemanticWeight] = useDebounceValue(semanticWeight, 250);
  const [draftFilters, setDraftFilters] = useState({ kind: "", status: "", tags: "" });
  const [appliedFilters] = useDebounceValue(draftFilters, 350);
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([]);
  const [degraded, setDegraded] = useState<{ active: boolean; reason?: string; effectiveWeight?: number }>({ active: false });
  const [responseBudget, setResponseBudget] = useState<SearchResult["responseBudget"]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const listRequests = useRef(new RequestGeneration());

  const searchQuery = debouncedQuery.trim();
  const isSearching = Boolean(searchQuery);
  const appliedFilterTags = useMemo(() => parseTagsInput(appliedFilters.tags), [appliedFilters.tags]);
  const activeFilterCount = Number(Boolean(appliedFilters.kind)) + Number(Boolean(appliedFilters.status)) + appliedFilterTags.length + Number(isSearching && semanticWeight !== 0.5);

  const load = useCallback(async () => {
    const token = listRequests.current.issue();
    setLoading(true);
    setError("");
    try {
      const validatedProject = stableIdentifier(project, t("common.fields.project"), 128);
      const validatedNamespace = stableIdentifier(namespace, t("common.fields.namespace"), 64);
      const validatedKind = appliedFilters.kind.trim();
      const validatedStatus = appliedFilters.status.trim();
      const validatedTags = tagsFromInput(appliedFilters.tags);
      if (validatedKind.length > 128) throw new UserFacingError(t("memories.validation.kindLength"));
      if (validatedStatus.length > 64) throw new UserFacingError(t("memories.validation.statusLength"));
      if (searchQuery.length > 2_000) throw new UserFacingError(t("memories.validation.queryLength"));
      const filters = { ...(validatedKind ? { kind: validatedKind } : {}), ...(validatedStatus ? { status: validatedStatus } : {}), ...(validatedTags.length ? { tags: validatedTags } : {}) };
      if (searchQuery) {
        const { result } = await api.memorySearch({ project: validatedProject, namespace: validatedNamespace, query: searchQuery, semantic_weight: debouncedSemanticWeight, max_response_chars: 100_000, limit: 20, ...(Object.keys(filters).length ? { filters } : {}) });
        if (!listRequests.current.isCurrent(token)) return;
        setRows(result.items.map((hit) => ({ record: hit.record, score: hit.score })));
        setResponseBudget(result.responseBudget);
        setDegraded({ active: result.degraded, reason: result.degradationReason, effectiveWeight: result.effectiveSemanticWeight });
        setNextCursor(undefined);
      } else {
        const result = await api.memoryList({ project: validatedProject, namespace: validatedNamespace, limit: 20, ...(cursor ? { cursor } : {}), ...(Object.keys(filters).length ? { filters: { ...filters, tag_match: "any" as const } } : {}) });
        if (!listRequests.current.isCurrent(token)) return;
        setRows(result.items.map((item) => ({ record: item })));
        setResponseBudget(undefined);
        setNextCursor(result.nextCursor);
        setDegraded({ active: false });
      }
    } catch (cause) {
      if (!listRequests.current.isCurrent(token)) return;
      handleApiError(cause);
      setError(errorMessage(cause));
    } finally {
      if (listRequests.current.isCurrent(token)) setLoading(false);
    }
  }, [api, appliedFilters, cursor, debouncedSemanticWeight, handleApiError, namespace, project, searchQuery, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => listRequests.current.invalidate(), []);
  useEffect(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, [appliedFilters]);

  const resetPage = useCallback(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, []);

  const previousPage = useCallback(() => {
    setCursorHistory((history) => {
      const next = [...history];
      setCursor(next.pop());
      return next;
    });
  }, []);

  const nextPage = useCallback(() => {
    setCursorHistory((history) => [...history, cursor]);
    setCursor(nextCursor);
  }, [cursor, nextCursor]);

  return {
    rows,
    loading,
    error,
    setError,
    load,
    query,
    setQuery,
    searchQuery,
    isSearching,
    semanticWeight,
    setSemanticWeight,
    draftFilters,
    setDraftFilters,
    appliedFilters,
    appliedFilterTags,
    activeFilterCount,
    degraded,
    responseBudget,
    cursorHistory,
    nextCursor,
    resetPage,
    previousPage,
    nextPage,
  };
}
