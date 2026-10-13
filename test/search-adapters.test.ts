import { describe, expect, it, vi } from "vitest";
import { CloudflareVectorIndex, WorkersAiEmbeddingProvider } from "../server/search/cloudflare-adapters";

describe("Cloudflare semantic adapters", () => {
  it("uses query and document modes with the same model", async () => {
    const run = vi.fn(async () => ({ data: [[1, 2, 3]] }));
    const provider = new WorkersAiEmbeddingProvider({ run } as unknown as Pick<Ai, "run">, "multilingual-model", 3);
    await provider.embedQuery("中文 query");
    await provider.embedDocument("English document");
    expect(run).toHaveBeenNthCalledWith(1, "multilingual-model", { queries: ["中文 query"] });
    expect(run).toHaveBeenNthCalledWith(2, "multilingual-model", { documents: ["English document"] });
  });

  it("rejects invalid AI shapes and dimensions", async () => {
    await expect(
      new WorkersAiEmbeddingProvider({ run: async () => ({ data: [[1, 2]] }) } as unknown as Pick<Ai, "run">, "model", 3).embedQuery("x"),
    ).rejects.toThrow("dimensions");
    await expect(
      new WorkersAiEmbeddingProvider({ run: async () => ({ nope: true }) } as unknown as Pick<Ai, "run">, "model", 3).embedQuery("x"),
    ).rejects.toThrow("shape");
  });

  it("never requests vector values and records typed mutation acceptance", async () => {
    const query = vi.fn(async () => ({ matches: [{ id: "vec_1", score: 0.9 }], count: 1 }));
    // Live Vectorize mutations return { mutationId } without count/ids.
    const index = new CloudflareVectorIndex({
      query,
      upsert: async () => ({ mutationId: "mut_up_1" }) as unknown as VectorizeVectorMutation,
      deleteByIds: async () => ({ mutationId: "mut_del_1" }) as unknown as VectorizeVectorMutation,
    });
    expect(await index.query([1, 2], 50)).toEqual([{ id: "vec_1" }]);
    expect(query).toHaveBeenCalledWith([1, 2], { topK: 50, returnValues: false, returnMetadata: "none" });
    expect((await index.upsert({ id: "vec_1", values: [1, 2] })).mutationId).toBe("accepted:upsert:mut_up_1");
    const legacy = new CloudflareVectorIndex({
      query,
      upsert: async () => ({ ids: ["vec_1"], count: 1 }),
      deleteByIds: async () => ({ ids: ["vec_1"], count: 1 }),
    });
    expect((await legacy.upsert({ id: "vec_1", values: [1, 2] })).mutationId).toBe("accepted:upsert:1:vec_1");
  });
});
