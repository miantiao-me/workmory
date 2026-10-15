import type { SearchResult } from "../domain/memory";

export function normalizeSearchResponseChars(value?: number): number {
  return value === undefined || !Number.isFinite(value)
    ? 16_000
    : Math.min(100_000, Math.max(2_000, Math.trunc(value)));
}

export function finalizeSearchResult(
  result: Omit<SearchResult, "responseBudget">,
  requestedMaxChars?: number,
): SearchResult {
  const maxChars = normalizeSearchResponseChars(requestedMaxChars);
  for (let count = result.items.length; count >= 0; count -= 1) {
    const candidate: SearchResult = {
      ...result,
      items: result.items.slice(0, count),
      responseBudget: { maxChars, omittedItems: result.items.length - count },
    };
    if (JSON.stringify(candidate).length <= maxChars) return candidate;
  }
  // Search metadata is bounded and always fits the minimum supported budget.
  return { ...result, items: [], responseBudget: { maxChars, omittedItems: result.items.length } };
}
