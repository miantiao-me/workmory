import { describe, expect, it } from "vitest";
import {
  RequestGeneration,
  ContextRequestGeneration,
  checkpointExpectedRevision,
  checkpointSummary,
  errorMessage,
  formatDate,
  idempotencyKeyFromInput,
  isCredentialRejection,
  makeOperationId,
  operationIdFromInput,
  stableIdentifier,
  tagsFromInput,
  UserFacingError,
} from "../web/lib/presentation";
import { ApiError } from "../web/lib/api/client";
import i18n from "../web/lib/i18n";

describe("browser state helpers", () => {
  it("accepts only the latest request generation and invalidates pending work", () => {
    const requests = new RequestGeneration();
    const first = requests.issue();
    const second = requests.issue();

    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);

    requests.invalidate();
    expect(requests.isCurrent(second)).toBe(false);
  });

  it("does not let memory detail A overwrite a newer detail B", () => {
    const details = new RequestGeneration();
    const requestA = details.issue();
    const requestB = details.issue();
    let committed = "";

    if (details.isCurrent(requestB)) committed = "B";
    if (details.isCurrent(requestA)) committed = "A";

    expect(committed).toBe("B");
  });

  it("does not let checkpoint mutation A overwrite context B and creates at revision zero", () => {
    const checkpoints = new ContextRequestGeneration();
    checkpoints.setContext("project-a/default");
    const mutationA = checkpoints.issue("project-a/default");

    expect(checkpointExpectedRevision(undefined)).toBe(0);
    expect(checkpointExpectedRevision(4)).toBe(4);

    checkpoints.setContext("project-b/default");
    const loadB = checkpoints.issue("project-b/default");
    let committed = "";
    if (checkpoints.isCurrent(loadB)) committed = "B";
    if (checkpoints.isCurrent(mutationA)) committed = "A";

    expect(committed).toBe("B");
    expect(checkpoints.isCurrent(mutationA)).toBe(false);
  });

  it("separates rejected credentials from verification outages", () => {
    expect(isCredentialRejection(new ApiError("AUTH_INVALID", "denied", 401))).toBe(true);
    expect(isCredentialRejection(new ApiError("ROOT_REQUIRED", "denied", 403))).toBe(true);
    expect(isCredentialRejection(new ApiError("HTTP_500", "offline", 500))).toBe(false);
    expect(isCredentialRejection(new ApiError("AUTH_CONFIG_INVALID", "offline", 503))).toBe(false);
  });

  it("localizes known API errors and hides unknown server messages", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(errorMessage(new ApiError("REVISION_CONFLICT", "server detail", 409))).toBe("数据已被修改，请刷新后重试。");
    expect(errorMessage(new ApiError("INTERNAL_DETAIL", "sensitive server detail", 500))).toBe("请求失败，请重试。");
    expect(errorMessage(new UserFacingError("本地校验失败。"))).toBe("本地校验失败。");
    expect(errorMessage(new Error("sensitive detail"))).toBe("请求失败，请重试。");
    expect(errorMessage(new ApiError("OPERATION_CONFLICT", "server detail", 409))).toBe("operation_id 已被占用，请生成新值后重试。");
    expect(errorMessage(new ApiError("IDEMPOTENCY_CONFLICT", "server detail", 409))).toBe("幂等键已被占用，请生成新值后重试。");
    expect(errorMessage(new ApiError("ATTACHMENT_NOT_READY", "server detail", 409))).toBe("附件尚未就绪，请稍后重试。");
    expect(errorMessage(new ApiError("PAYLOAD_TOO_LARGE", "server detail", 413))).toBe("文件或内容超出大小限制。");
    expect(errorMessage(new ApiError("UNSUPPORTED_MEDIA", "server detail", 415))).toBe("文件格式不受支持或与内容不符。");
    expect(errorMessage(new ApiError("REMOTE_TIMEOUT", "server detail", 504))).toBe("远程导入超时，请稍后重试。");

    await i18n.changeLanguage("en");
    expect(errorMessage(new ApiError("REVISION_CONFLICT", "server detail", 409))).toBe("Data changed elsewhere. Refresh and retry.");
    expect(errorMessage(new ApiError("INTERNAL_DETAIL", "sensitive server detail", 500))).toBe("Request failed. Try again.");
    expect(errorMessage(new UserFacingError("Local validation failed."))).toBe("Local validation failed.");
    expect(errorMessage(new TypeError("sensitive detail"))).toBe("Request failed. Try again.");
    expect(errorMessage(new ApiError("PAYLOAD_TOO_LARGE", "server detail", 413))).toBe("Content exceeds size limit.");
    await i18n.changeLanguage("zh-CN");
  });

  it("formats dates using the current locale", async () => {
    const value = "2026-08-21T12:34:00.000Z";
    const date = new Date(value);
    await i18n.changeLanguage("zh-CN");
    expect(formatDate(value)).toBe(new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date));
    await i18n.changeLanguage("en");
    expect(formatDate(value)).toBe(new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date));
    await i18n.changeLanguage("zh-CN");
  });

  it("validates common wire-contract boundaries without changing content", () => {
    expect(stableIdentifier(" project-a ", "项目", 128)).toBe("project-a");
    expect(tagsFromInput("alpha, beta")).toEqual(["alpha", "beta"]);
    expect(operationIdFromInput(" update:123456 ")).toBe("update:123456");
    expect(idempotencyKeyFromInput(" upload-retry ")).toBe("upload-retry");
    expect(() => tagsFromInput(Array.from({ length: 33 }, (_, index) => `t${index}`).join(","))).toThrow("最多添加 32 个标签");
    expect(() => operationIdFromInput("short", true)).toThrow("8–128");
  });

  it("creates UUID-backed operation IDs", () => {
    expect(makeOperationId("memory-store")).toMatch(/^memory-store:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(makeOperationId("x".repeat(120))).toHaveLength(128);
  });

  it("extracts checkpoint summary from returned OKF frontmatter", async () => {
    const markdown = "---\ntype: Checkpoint\ndescription: Storage phase\n---\nMilestone complete";
    await expect(checkpointSummary(markdown)).resolves.toBe("Storage phase");
    await expect(checkpointSummary("plain text")).resolves.toBeUndefined();
  });
});
