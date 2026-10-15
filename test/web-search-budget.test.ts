import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { memory as en } from "../web/locales/en/memory";
import { memory as zh } from "../web/locales/zh-CN/memory";

// Keep this rendering check independent of vendored UI primitives and their app aliases.
vi.mock("../web/components/ui/card", () => ({ Card: ({ children }: { children: ReactNode }) => createElement("div", null, children), CardFooter: () => null }));
vi.mock("../web/components/ui/button", () => ({ Button: ({ children }: { children: ReactNode }) => createElement("button", null, children) }));
vi.mock("../web/components/ui/skeleton", () => ({ Skeleton: () => null }));
vi.mock("../web/components/ui/table", () => {
  const element = ({ children }: { children: ReactNode }) => createElement("div", null, children);
  return { Table: element, TableBody: element, TableCell: element, TableHead: element, TableHeader: element, TableRow: element };
});
vi.mock("../web/components/common", () => ({ EmptyState: ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => createElement("section", null, title, description, action) }));
vi.mock("../web/pages/memories/memory-list-row", () => ({ MemoryListRow: ({ record }: { record: { snippet?: string } }) => createElement("span", null, record.snippet) }));
import { MemoryResults } from "../web/pages/memories/memory-results";

const actions = { onOpen: () => {}, onOpenNew: () => {}, onPreviousPage: () => {}, onNextPage: () => {} };

async function render(language: "en" | "zh-CN", omittedItems: number, { hasRows = false, isSearching = true, hasError = false, loading = false } = {}) {
  const i18n = createInstance();
  await i18n.init({ lng: language, resources: { en: { translation: en }, "zh-CN": { translation: zh } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(MemoryResults, {
    ...actions, rows: hasRows ? [{ record: { project: "project", namespace: "default", key: "key", revision: 1, tags: [], snippet: "Excerpt" } }] : [],
    loading, hasError, isSearching, cursorHistory: [], responseBudget: { maxChars: 100000, omittedItems },
  })));
}

describe("search budget feedback", () => {
  it.each(["en", "zh-CN"] as const)("distinguishes an oversized first result from zero matches in %s", async (language) => {
    const messages = language === "en" ? en.memories : zh.memories;
    const oversized = await render(language, 1);
    expect(oversized).toContain(messages.budget.title);
    expect(oversized).toContain(messages.budget.description);
    expect(oversized).not.toContain(messages.empty.noResults);
    expect(oversized).not.toContain("<button");
    const empty = await render(language, 0);
    expect(empty).toContain(messages.empty.noResults);
    expect(empty).not.toContain(messages.budget.title);
  });

  it.each(["en", "zh-CN"] as const)("hides stale empty success feedback after a failed request in %s", async (language) => {
    const messages = language === "en" ? en.memories : zh.memories;
    expect(await render(language, 1)).toContain(messages.budget.title);

    const failed = await render(language, 1, { hasError: true });
    expect(failed).toBe("");
    expect(failed).not.toContain(messages.budget.title);
    expect(failed).not.toContain(messages.empty.noResults);
  });

  it.each(["en", "zh-CN"] as const)("retains previous excerpts without budget conclusions after failure in %s", async (language) => {
    const messages = language === "en" ? en.memories : zh.memories;
    const failed = await render(language, 2, { hasRows: true, hasError: true });
    expect(failed).toContain("Excerpt");
    expect(failed).not.toContain('role="status"');
    expect(failed).not.toContain(messages.budget.title);
    expect(failed).not.toContain(messages.empty.noResults);
  });

  it.each([false, true])("hides budget feedback while loading with retained rows: %s", async (hasRows) => {
    const loading = await render("en", 2, { hasRows, loading: true });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain("omitted");
    expect(loading).not.toContain(en.memories.budget.title);
    expect(loading).not.toContain(en.memories.empty.noResults);
  });

  it("announces omissions alongside retained excerpts and clears feedback for listing", async () => {
    const partial = await render("en", 2, { hasRows: true });
    expect(partial).toContain("2 results omitted to fit the response budget.");
    expect(partial).toContain('role="status"');
    expect(partial).toContain("Excerpt");
    expect(await render("en", 1, { hasRows: true })).toContain("1 result omitted to fit the response budget.");
    expect(await render("en", 2, { hasRows: true, isSearching: false })).not.toContain("omitted");
  });
});
