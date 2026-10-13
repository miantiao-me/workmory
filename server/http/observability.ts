type ErrorWithCode = { code?: unknown; status?: unknown };

export interface RequestLog {
  request_id: string;
  route: string;
  status: number;
  duration_ms: number;
  error_code: string | null;
  dependency: string | null;
}

function errorCode(error: unknown, status: number): string | null {
  if (error && typeof error === "object" && typeof (error as ErrorWithCode).code === "string") {
    return (error as ErrorWithCode).code as string;
  }
  return status >= 400 ? `HTTP_${status}` : null;
}

function dependencyFor(code: string | null): string | null {
  if (!code) return null;
  if (code === "AUTH_CONFIG_INVALID") return "access";
  if (code.startsWith("REMOTE_")) return "remote_https";
  if (code.startsWith("CONVERSION_")) return "workers_ai";
  if (code === "INTEGRITY_ERROR") return "r2";
  return null;
}

function statusOf(value: unknown): number {
  return value instanceof Response ? value.status : 200;
}

export async function observeRequest<T>(
  route: string,
  operation: () => T | Promise<T>,
  respondToError?: (error: unknown) => T | Promise<T>,
): Promise<T> {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let result: T;
  let error: unknown;

  try {
    result = await operation();
  } catch (caught) {
    error = caught;
    if (!respondToError) throw caught;
    result = await respondToError(caught);
  }

  const status = statusOf(result);
  const code = errorCode(error, status);
  const log: RequestLog = {
    request_id: requestId,
    route,
    status,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    error_code: code,
    dependency: dependencyFor(code),
  };
  console.info(log);

  if (result instanceof Response) result.headers.set("X-Request-ID", requestId);
  return result;
}
