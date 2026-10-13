import { retryErrorMessage } from "./maintenance-retry";

// Rollback/cleanup failures must not replace the primary error; they are logged so the original fault stays visible.
export function logCleanupFailure(operation: string, error: unknown): void {
  console.warn(`${operation} cleanup failed: ${retryErrorMessage(error)}`);
}
