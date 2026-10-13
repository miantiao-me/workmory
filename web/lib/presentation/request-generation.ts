export class RequestGeneration {
  private generation = 0;

  issue(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }
}

export interface ContextRequestToken {
  contextKey: string;
  generation: number;
}

export class ContextRequestGeneration {
  private contextKey = "";
  private generation = 0;

  setContext(contextKey: string): void {
    if (contextKey === this.contextKey) return;
    this.contextKey = contextKey;
    this.generation += 1;
  }

  issue(contextKey: string): ContextRequestToken {
    this.setContext(contextKey);
    this.generation += 1;
    return { contextKey, generation: this.generation };
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(token: ContextRequestToken): boolean {
    return token.contextKey === this.contextKey && token.generation === this.generation;
  }
}
