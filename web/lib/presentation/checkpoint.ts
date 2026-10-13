export function checkpointExpectedRevision(revision?: number): number {
  return revision ?? 0;
}

export async function checkpointSummary(okfMarkdown?: string): Promise<string | undefined> {
  if (!okfMarkdown) return undefined;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(okfMarkdown)?.[1];
  if (!frontmatter) return undefined;
  try {
    const { parse } = await import("yaml");
    const value: unknown = parse(frontmatter);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const description = (value as Record<string, unknown>).description;
    return typeof description === "string" ? description : undefined;
  } catch {
    return undefined;
  }
}
