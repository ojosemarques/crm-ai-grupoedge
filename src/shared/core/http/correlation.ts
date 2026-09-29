const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function resolveCorrelationId(headers: Headers): string {
  const candidate = headers.get("x-correlation-id")?.trim();
  return candidate && SAFE_CORRELATION_ID.test(candidate) ? candidate : crypto.randomUUID();
}

export function correlationResponseHeaders(correlationId: string): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-Correlation-Id": correlationId,
  };
}
