const MAX_ERROR_LENGTH = 1_000;

export function retryDelay(attempts: number): number {
  return Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 12));
}

export function retryErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
}
