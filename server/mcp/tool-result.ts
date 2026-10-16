import type { CallToolResult } from "@modelcontextprotocol/server";
import { MemoryServiceError } from "../application/memory-service";

function ok(message: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: message }, { type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function failed(error: unknown): CallToolResult {
  const code = error instanceof MemoryServiceError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof MemoryServiceError ? error.message : "The tool operation failed.";
  const data = { error: { code, message } };
  return {
    content: [{ type: "text", text: `${code}: ${message}` }, { type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError: true,
  };
}

export async function toolResult(
  action: () => Promise<Record<string, unknown>>,
  message: string | ((data: Record<string, unknown>) => string),
): Promise<CallToolResult> {
  try {
    const data = await action();
    return ok(typeof message === "function" ? message(data) : message, data);
  } catch (error) {
    return failed(error);
  }
}
