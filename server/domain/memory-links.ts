import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { keySchema } from "./contracts";

export const MEMORY_LINK_EXTRACTOR_VERSION = "2";
export const MAX_MEMORY_LINKS = 256;
export const MAX_MEMORY_LINK_TARGET_BYTES = 2_048;

export interface ExtractedMemoryLink {
  origin: "link" | "source";
  rawTarget: string;
  targetKey: string;
  ordinal: number;
}

export interface MemoryLinkExtraction {
  links: ExtractedMemoryLink[];
  truncated: boolean;
  status: "complete" | "failed";
}

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export function normalizeMemoryLinkTarget(sourceKey: string, rawTarget: string): string | null {
  if (!rawTarget || byteLength(rawTarget) > MAX_MEMORY_LINK_TARGET_BYTES) return null;
  if (rawTarget.startsWith("#") || rawTarget.startsWith("//") || rawTarget.includes("\\") || /[\u0000-\u001f]/.test(rawTarget)) return null;

  const path = rawTarget.split(/[?#]/, 1)[0];
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || /%(?:2f|5c|00)/i.test(path)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0") || !decoded.toLowerCase().endsWith(".md")) return null;

  const base = decoded.startsWith("/") ? [] : sourceKey.split("/").slice(0, -1);
  const parts = [...base, ...decoded.replace(/^\/+/, "").split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length === 0) return null;
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  if (normalized.length === 0) return null;
  normalized[normalized.length - 1] = normalized.at(-1)!.slice(0, -3);
  if (!normalized.at(-1)) return null;
  const key = normalized.join("/");
  return keySchema.safeParse(key).success ? key : null;
}

export function extractMemoryLinks(sourceKey: string, body: string, sources: unknown): MemoryLinkExtraction {
  const candidates: { origin: "link" | "source"; rawTarget: string }[] = [];
  try {
    const tree = unified().use(remarkParse).parse(body);
    const definitions = new Map<string, string>();
    // CommonMark: when multiple definitions share an identifier, the first one wins.
    visit(tree, "definition", (node) => {
      const identifier = node.identifier?.toLowerCase();
      if (identifier && !definitions.has(identifier)) definitions.set(identifier, node.url);
    });
    visit(tree, (node) => {
      if (node.type === "link") candidates.push({ origin: "link", rawTarget: node.url });
      if (node.type === "linkReference" && node.identifier) {
        const target = definitions.get(node.identifier.toLowerCase());
        if (target !== undefined) candidates.push({ origin: "link", rawTarget: target });
      }
    });
  } catch {
    return { links: [], truncated: false, status: "failed" };
  }

  const sourceEntries = Array.isArray(sources) ? sources : sources ? [sources] : [];
  for (const source of sourceEntries) {
    if (source && typeof source === "object" && typeof (source as { resource?: unknown }).resource === "string") {
      candidates.push({ origin: "source", rawTarget: (source as { resource: string }).resource });
    }
  }

  const links: ExtractedMemoryLink[] = [];
  let truncated = false;
  for (const candidate of candidates) {
    if (byteLength(candidate.rawTarget) > MAX_MEMORY_LINK_TARGET_BYTES) {
      truncated = true;
      continue;
    }
    const targetKey = normalizeMemoryLinkTarget(sourceKey, candidate.rawTarget);
    if (!targetKey) continue;
    if (links.length === MAX_MEMORY_LINKS) {
      truncated = true;
      break;
    }
    links.push({ ...candidate, targetKey, ordinal: links.length });
  }
  return { links, truncated, status: "complete" };
}
