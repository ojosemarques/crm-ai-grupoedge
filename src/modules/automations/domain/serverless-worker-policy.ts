import { timingSafeEqual } from "node:crypto";

import { ApplicationError, ConfigurationError } from "@/shared/core/errors/application-error";

export type ServerlessWorkerPolicy = Readonly<{
  enabled: boolean;
  secret: string;
  maxJobs: number;
  maxDurationMs: number;
}>;

export function loadServerlessWorkerPolicy(
  source: Readonly<Record<string, string | undefined>>,
): ServerlessWorkerPolicy {
  const enabled = source.SERVERLESS_WORKER_ENABLED === "true";
  const secret = source.SERVERLESS_WORKER_SECRET?.trim() ?? "";
  const maxJobs = Number(source.SERVERLESS_WORKER_MAX_JOBS ?? 10);
  const maxDurationMs = Number(source.SERVERLESS_WORKER_MAX_DURATION_MS ?? 40_000);
  const invalid: string[] = [];

  if (source.SERVERLESS_WORKER_ENABLED !== "true" && source.SERVERLESS_WORKER_ENABLED !== "false") {
    invalid.push("SERVERLESS_WORKER_ENABLED");
  }
  if (secret.length < 32) invalid.push("SERVERLESS_WORKER_SECRET");
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 25) invalid.push("SERVERLESS_WORKER_MAX_JOBS");
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 45_000) {
    invalid.push("SERVERLESS_WORKER_MAX_DURATION_MS");
  }
  if (source.APP_ENV !== "staging" && source.APP_ENV !== "production") invalid.push("APP_ENV");
  if (source.EXTERNAL_ADAPTERS_MODE !== "disabled") invalid.push("EXTERNAL_ADAPTERS_MODE");
  if (invalid.length > 0) throw new ConfigurationError([...new Set(invalid)].sort());

  return Object.freeze({ enabled, secret, maxJobs, maxDurationMs });
}

export function assertServerlessWorkerEnabled(policy: ServerlessWorkerPolicy): void {
  if (!policy.enabled) {
    throw new ApplicationError("O worker remoto está pausado pelo kill switch.", {
      code: "WORKER_DISABLED",
      statusCode: 503,
      expose: true,
    });
  }
}

export function assertServerlessWorkerRequest(
  request: Request,
  policy: ServerlessWorkerPolicy,
): void {
  const url = new URL(request.url);
  if (url.search.length > 0) {
    throw new ApplicationError("A invocação interna não aceita query string.", {
      code: "WORKER_QUERY_NOT_ALLOWED",
      statusCode: 400,
      expose: true,
    });
  }
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(policy.secret);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new ApplicationError("Credencial interna inválida.", {
      code: "WORKER_UNAUTHENTICATED",
      statusCode: 401,
      expose: true,
    });
  }
}
