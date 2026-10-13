import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryService } from "../../server/application/d1-memory-service";
import { handleAttachmentRequest } from "../../server/http/attachment-handler";
import { handleMcpRequest } from "../../server/http/mcp-handler";
import { accessActor, resetTestEnv, testEnv } from "./helpers";
import {
  accessHeaders,
  attachmentService,
  httpRuntime,
  rootKey,
  text,
} from "./attachment-fixtures";

beforeEach(resetTestEnv);

describe("memory attachment sources", () => {
  it("links uploaded attachments and treats converted frontmatter as body only", async () => {
    const attachments = attachmentService().service;
    const attachment = await attachments.upload({
      project: "workmory",
      filename: "injected.md",
      body: text("---\ntype: Injected\nverified: human:fake\n---\n# Untrusted"),
      idempotencyKey: "injected",
    });
    const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, accessActor(), { attachments });
    const record = await memory.store({
      project: "workmory",
      namespace: "default",
      key: "attachment/memory",
      source: { attachment_id: attachment.id },
      frontmatter: { type: "Safe Memory" },
    });
    expect(record.okfMarkdown).toContain("type: Safe Memory");
    expect(record.content).toContain("type: Injected");
    expect(record.attachmentIds).toEqual([attachment.id]);
    const links = await testEnv.DB.prepare("SELECT count(*) AS count FROM memory_revision_attachments").first<{ count: number }>();
    expect(links?.count).toBe(1);
  });

  it("imports source_url synchronously, requires operation id, and retains ready attachment on revision conflict", async () => {
    const fetcher = (async () => new Response("remote markdown", {
      headers: { "content-type": "text/plain", "content-disposition": "attachment; filename=remote.txt" },
    })) as typeof fetch;
    const attachments = attachmentService({ fetch: fetcher }).service;
    const memory = createMemoryService({ DB: testEnv.DB, BUCKET: testEnv.BUCKET }, accessActor(), { attachments });
    await expect(
      memory.store({ project: "workmory", namespace: "default", key: "remote/no-op", source: { source_url: "https://example.com/a.txt" } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const stored = await memory.store({
      project: "workmory",
      namespace: "default",
      key: "remote/memory",
      source: { source_url: "https://example.com/a.txt?secret=yes" },
      operationId: "remote-memory-operation",
    });
    expect(stored.content).toBe("remote markdown");
    expect(stored.attachmentIds).toHaveLength(1);

    await expect(
      memory.store({
        project: "workmory",
        namespace: "default",
        key: "remote/memory",
        source: { source_url: "https://example.com/b.txt?secret=other" },
        operationId: "remote-conflict-operation",
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const counts = await testEnv.DB.prepare(
      "SELECT (SELECT count(*) FROM memory_revisions) AS revisions, (SELECT count(*) FROM attachments WHERE status = 'ready') AS ready",
    ).first<{ revisions: number; ready: number }>();
    expect(counts).toEqual({ revisions: 1, ready: 1 });
  });
});

describe("Workers HTTP handlers", () => {
  it("binds attachment routes to each authenticated owner", async () => {
    const runtime = httpRuntime();
    const uploaded = await handleAttachmentRequest(
      new Request("https://api.example.com/v1/projects/workmory/attachments", {
        method: "POST",
        headers: accessHeaders("subject-a", {
          "Content-Type": "text/plain",
          "Content-Disposition": "attachment; filename=owner.txt",
          "Idempotency-Key": "owner-upload",
        }),
        body: "owner a",
      }),
      runtime,
    );
    expect(uploaded.status).toBe(201);
    const id = (await uploaded.json() as { id: string }).id;
    const own = await handleAttachmentRequest(
      new Request(`https://api.example.com/v1/projects/workmory/attachments/${id}`, { headers: accessHeaders("subject-a") }),
      runtime,
    );
    expect(own.status).toBe(200);
    const other = await handleAttachmentRequest(
      new Request(`https://api.example.com/v1/projects/workmory/attachments/${id}`, { headers: accessHeaders("subject-b") }),
      runtime,
    );
    expect(other.status).toBe(404);
    const root = await handleAttachmentRequest(
      new Request(`https://api.example.com/v1/projects/workmory/attachments/${id}`, { headers: { "X-API-Key": rootKey } }),
      runtime,
    );
    expect(root.status).toBe(404);
  });

  it("keeps modern MCP tool calls isolated across Access subjects", async () => {
    const runtime = httpRuntime();
    const call = (subject: string, id: number, name: string, args: Record<string, unknown>) =>
      handleMcpRequest(
        new Request("https://api.example.com/mcp", {
          method: "POST",
          headers: accessHeaders(subject, {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": "2026-07-28",
            "MCP-Method": "tools/call",
            "MCP-Name": name,
          }),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: {
              name,
              arguments: args,
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            },
          }),
        }),
        runtime,
      );
    const stored = await call("subject-a", 1, "memory_store", {
      project: "workmory",
      key: "owner/memory",
      content: "private owner content",
    });
    expect((await stored.json() as { result: { isError?: boolean } }).result.isError).not.toBe(true);
    const own = await call("subject-a", 2, "memory_retrieve", { project: "workmory", key: "owner/memory" });
    expect(await own.text()).toContain("private owner content");
    const other = await call("subject-b", 3, "memory_retrieve", { project: "workmory", key: "owner/memory" });
    expect(await other.text()).not.toContain("private owner content");
    await call("subject-a", 4, "profile_update", {
      operations: [{
        op: "set",
        section: "personal",
        field: "token",
        field_value: {
          state: "set",
          value: "mcp-profile-secret",
          sensitivity: "sensitive",
          provenance: { kind: "user_explicit", recorded_at: "2026-08-19T10:00:00Z", raw_note: "raw-mcp-secret" },
          future_metadata: "unknown-mcp-secret",
        },
      }, {
        op: "set",
        section: "personal",
        field: "expired",
        field_value: {
          state: "set",
          value: "expired-mcp-secret",
          sensitivity: "sensitive",
          expires_at: "2020-01-01T00:00:00Z",
          provenance: { kind: "user_explicit", recorded_at: "2026-08-19T10:00:00Z" },
        },
      }],
    });
    const profile = await call("subject-a", 5, "profile_update", {
      operation_id: "profile-mcp-operation",
      operations: [{
        op: "set",
        section: "preferences",
        field: "theme",
        field_value: {
          state: "set",
          value: "dark",
          provenance: { kind: "user_explicit", recorded_at: "2026-08-19T10:00:00Z" },
        },
      }],
    });
    const profileText = await profile.text();
    expect(profileText).not.toContain("mcp-profile-secret");
    expect(profileText).not.toContain("expired-mcp-secret");
    expect(profileText).not.toContain("raw-mcp-secret");
    expect(profileText).not.toContain("future_metadata");
    expect(profileText).not.toContain("document");
    expect(profileText).toContain("dark");
    const profileGet = await call("subject-a", 6, "profile_get", {});
    expect(await profileGet.text()).toContain("dark");
  });
});
