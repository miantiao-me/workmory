import { assertVectorDimensions, type EmbeddingProvider, type SemanticRuntime, type VectorIndex } from "./types";

type AiRunner = Pick<Ai, "run">;

type VectorizeBinding = Pick<VectorizeIndex, "upsert" | "deleteByIds" | "query">;

// Live Vectorize returns { mutationId }; older runtimes/mocks may return { count, ids }.
function acceptanceToken(action: "upsert" | "delete", result: VectorizeVectorMutation): string {
  const mutationId = (result as { mutationId?: unknown }).mutationId;
  if (typeof mutationId === "string" && mutationId.length > 0) return `accepted:${action}:${mutationId}`.slice(0, 256);
  const ids = (result as { ids?: unknown }).ids;
  const count = (result as { count?: unknown }).count;
  return `accepted:${action}:${typeof count === "number" ? count : "?"}:${Array.isArray(ids) ? [...ids].sort().join(",") : ""}`.slice(0, 256);
}

export class WorkersAiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly ai: AiRunner,
    private readonly model: string,
    private readonly dimensions: number,
  ) {}

  private async embed(input: Record<string, unknown>): Promise<number[]> {
    const result: unknown = await this.ai.run(this.model as keyof AiModels, input as never);
    const data = result && typeof result === "object" && "data" in result ? result.data : undefined;
    const vector = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : undefined;
    if (!vector || !vector.every((value) => typeof value === "number")) {
      throw new Error("Workers AI returned an invalid embedding shape");
    }
    assertVectorDimensions(vector, this.dimensions);
    return vector;
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embed({ queries: [text] });
  }

  embedDocument(text: string): Promise<number[]> {
    return this.embed({ documents: [text] });
  }
}

export class CloudflareVectorIndex implements VectorIndex {
  constructor(private readonly index: VectorizeBinding) {}

  async upsert(input: { id: string; values: number[]; namespace?: string; metadata?: Record<string, string | number> }) {
    const result = await this.index.upsert([input]);
    return { mutationId: acceptanceToken("upsert", result) };
  }

  async delete(id: string) {
    const result = await this.index.deleteByIds([id]);
    return { mutationId: acceptanceToken("delete", result) };
  }

  async query(values: number[], topK: number, scope?: { namespace: string }) {
    const result = await this.index.query(values, {
      topK,
      ...(scope ? { namespace: scope.namespace } : {}),
      returnValues: false,
      returnMetadata: "none",
    });
    return result.matches.map((match) => ({ id: match.id }));
  }
}

export function createCloudflareSemanticRuntime(env: {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  EMBEDDING_MODEL: string;
  EMBEDDING_DIMENSIONS: string | number;
  VECTOR_INDEX_VERSION: string;
}): SemanticRuntime {
  const dimensions = Number(env.EMBEDDING_DIMENSIONS);
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error("EMBEDDING_DIMENSIONS must be a positive integer");
  return {
    embeddings: new WorkersAiEmbeddingProvider(env.AI, env.EMBEDDING_MODEL, dimensions),
    vectors: new CloudflareVectorIndex(env.VECTORIZE),
    config: { model: env.EMBEDDING_MODEL, dimensions, indexVersion: env.VECTOR_INDEX_VERSION },
  };
}
