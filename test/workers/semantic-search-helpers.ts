import type { EmbeddingProvider, SemanticRuntime, VectorIndex, VectorMatch } from "../../server/search/types";
import { testEnv } from "./helpers";

export class FakeEmbeddings implements EmbeddingProvider {
  queryCalls: string[] = [];
  documentCalls: string[] = [];
  fail = false;
  dimensions = 3;

  async embedQuery(text: string): Promise<number[]> {
    this.queryCalls.push(text);
    if (this.fail) throw new Error("embedding failed");
    return Array.from({ length: this.dimensions }, (_, index) => index + 1);
  }

  async embedDocument(text: string): Promise<number[]> {
    this.documentCalls.push(text);
    if (this.fail) throw new Error("embedding failed");
    return Array.from({ length: this.dimensions }, (_, index) => index + 1);
  }
}

export class FakeVectors implements VectorIndex {
  values = new Map<string, number[]>();
  queryMatches: VectorMatch[] = [];
  queryCalls = 0;
  failQuery = false;
  failMutation = false;
  upsertCalls = 0;
  deleteCalls = 0;
  beforeUpsert?: () => Promise<void>;
  beforeDelete?: () => Promise<void>;

  async upsert(input: { id: string; values: number[] }): Promise<{ mutationId: string }> {
    this.upsertCalls += 1;
    if (this.failMutation) throw new Error("vector mutation failed");
    await this.beforeUpsert?.();
    this.values.set(input.id, input.values);
    return { mutationId: `upsert-${input.id}` };
  }

  async delete(id: string): Promise<{ mutationId: string }> {
    this.deleteCalls += 1;
    if (this.failMutation) throw new Error("vector mutation failed");
    await this.beforeDelete?.();
    this.values.delete(id);
    return { mutationId: `delete-${id}` };
  }

  async query(): Promise<VectorMatch[]> {
    this.queryCalls += 1;
    if (this.failQuery) throw new Error("vector query failed");
    return this.queryMatches;
  }
}

export function semanticRuntime() {
  const embeddings = new FakeEmbeddings();
  const vectors = new FakeVectors();
  const runtime: SemanticRuntime = {
    embeddings,
    vectors,
    config: { model: "fake-multilingual", dimensions: 3, indexVersion: "test-v1" },
  };
  return { runtime, embeddings, vectors };
}

export async function vectorIds(): Promise<string[]> {
  const rows = await testEnv.DB.prepare("SELECT vector_id AS vectorId FROM semantic_vectors ORDER BY vector_id").all<{ vectorId: string }>();
  return rows.results.map((candidate) => candidate.vectorId);
}
