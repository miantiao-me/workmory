export interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedDocument(text: string): Promise<number[]>;
}

export interface VectorMutationResult {
  mutationId: string;
}

export interface VectorMatch {
  id: string;
}

export interface VectorScope {
  namespace: string;
}

export interface VectorIndex {
  upsert(input: { id: string; values: number[]; namespace?: string; metadata?: Record<string, string | number> }): Promise<VectorMutationResult>;
  delete(id: string): Promise<VectorMutationResult>;
  query(values: number[], topK: number, scope?: VectorScope): Promise<VectorMatch[]>;
}

export interface SemanticConfig {
  model: string;
  dimensions: number;
  indexVersion: string;
}

export interface SemanticRuntime {
  embeddings: EmbeddingProvider;
  vectors: VectorIndex;
  config: SemanticConfig;
}

export function assertVectorDimensions(vector: number[], dimensions: number): void {
  if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid embedding dimensions: expected ${dimensions}, received ${vector.length}`);
  }
}
