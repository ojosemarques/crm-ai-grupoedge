import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type RateLimitPolicy = Readonly<{
  limit: number;
  windowMs: number;
}>;

type RateLimitEntry = {
  count: number;
  resetsAt: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_NAMESPACE = /^[a-z0-9][a-z0-9:_-]{0,79}$/;

type SharedRateLimitResult = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}>;

type SharedRateLimiter = Readonly<{
  consume: (namespace: string, subject: string, policy: RateLimitPolicy) => Promise<SharedRateLimitResult>;
  clear: (namespace: string, subject: string) => Promise<void>;
}>;

function hashRateLimitSubject(namespace: string, subject: string): string {
  return createHash("sha256").update(`${namespace}:${subject}`).digest("hex");
}

export function createSharedRateLimiter(
  database: Pick<PrismaClient, "$queryRaw" | "$executeRaw">,
  now: () => Date = () => new Date(),
): SharedRateLimiter {
  function validate(namespace: string, policy: RateLimitPolicy): void {
    if (!RATE_LIMIT_NAMESPACE.test(namespace) || policy.limit < 1 || policy.windowMs < 1_000) {
      throw new ApplicationError("Política de limite inválida.", {
        code: "INVALID_RATE_LIMIT_POLICY",
        statusCode: 500,
      });
    }
  }

  return Object.freeze({
    async consume(namespace, subject, policy) {
      validate(namespace, policy);
      const observedAt = now();
      const subjectHash = hashRateLimitSubject(namespace, subject);
      const expiresAt = new Date(observedAt.getTime() + policy.windowMs);
      const rows = await database.$queryRaw<Array<{ requestCount: number; expiresAt: Date }>>(Prisma.sql`
        INSERT INTO "request_rate_limits" (
          "namespace", "subjectHash", "windowStartedAt", "expiresAt",
          "requestCount", "createdAt", "updatedAt"
        ) VALUES (
          ${namespace}, ${subjectHash}, ${observedAt}, ${expiresAt}, 1,
          ${observedAt}, ${observedAt}
        )
        ON CONFLICT ("namespace", "subjectHash") DO UPDATE SET
          "windowStartedAt" = CASE
            WHEN "request_rate_limits"."expiresAt" <= ${observedAt}
              THEN ${observedAt}
            ELSE "request_rate_limits"."windowStartedAt"
          END,
          "expiresAt" = CASE
            WHEN "request_rate_limits"."expiresAt" <= ${observedAt}
              THEN ${expiresAt}
            ELSE "request_rate_limits"."expiresAt"
          END,
          "requestCount" = CASE
            WHEN "request_rate_limits"."expiresAt" <= ${observedAt}
              THEN 1
            ELSE "request_rate_limits"."requestCount" + 1
          END,
          "updatedAt" = ${observedAt}
        RETURNING "requestCount", "expiresAt"
      `);
      const row = rows[0];
      if (!row) {
        throw new ApplicationError("O limite compartilhado não respondeu.", {
          code: "RATE_LIMIT_UNAVAILABLE",
          statusCode: 503,
        });
      }
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((row.expiresAt.getTime() - observedAt.getTime()) / 1_000),
      );
      return Object.freeze({
        allowed: row.requestCount <= policy.limit,
        remaining: Math.max(0, policy.limit - row.requestCount),
        retryAfterSeconds: row.requestCount <= policy.limit ? 0 : retryAfterSeconds,
      });
    },
    async clear(namespace, subject) {
      if (!RATE_LIMIT_NAMESPACE.test(namespace)) return;
      const subjectHash = hashRateLimitSubject(namespace, subject);
      await database.$executeRaw(Prisma.sql`
        DELETE FROM "request_rate_limits"
        WHERE "namespace" = ${namespace} AND "subjectHash" = ${subjectHash}
      `);
    },
  });
}

let sharedRateLimiter: SharedRateLimiter | undefined;

function getSharedRateLimiter(): SharedRateLimiter {
  sharedRateLimiter ??= createSharedRateLimiter(getDatabaseClient());
  return sharedRateLimiter;
}

export const sensitiveEndpointPolicies = {
  login: { limit: 30, windowMs: 5 * 60_000 },
  csvImport: { limit: 20, windowMs: 60_000 },
  localLeadEntry: { limit: 60, windowMs: 60_000 },
  artificialIntelligence: { limit: 30, windowMs: 60_000 },
  manualAutomation: { limit: 20, windowMs: 60_000 },
  whatsAppWebhook: { limit: 240, windowMs: 60_000 },
  telephony: { limit: 60, windowMs: 60_000 },
  telephonyCallback: { limit: 240, windowMs: 60_000 },
  calendar: { limit: 60, windowMs: 60_000 },
  calendarCallback: { limit: 240, windowMs: 60_000 },
  paymentWebhook: { limit: 240, windowMs: 60_000 },
  paymentAction: { limit: 60, windowMs: 60_000 },
  n8nMachine: { limit: 120, windowMs: 60_000 },
  n8nAdministration: { limit: 30, windowMs: 60_000 },
  operations: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export async function readLimitedBuffer(request: Request, maximumBytes: number): Promise<Buffer> {
  const advertisedLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) {
    throw new ApplicationError("O corpo da solicitação excede o limite permitido.", { code: "REQUEST_BODY_TOO_LARGE", statusCode: 413, expose: true });
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ApplicationError("O corpo da solicitação excede o limite permitido.", { code: "REQUEST_BODY_TOO_LARGE", statusCode: 413, expose: true });
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function invalidJson(): ApplicationError {
  return new ApplicationError("O corpo JSON da solicitação é inválido.", {
    code: "INVALID_JSON_BODY",
    statusCode: 400,
    expose: true,
  });
}

export async function readLimitedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw new ApplicationError("Envie o corpo como application/json.", {
      code: "UNSUPPORTED_MEDIA_TYPE",
      statusCode: 415,
      expose: true,
    });
  }

  const advertisedLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > maximumBytes) {
    throw new ApplicationError("O corpo da solicitação excede o limite permitido.", {
      code: "REQUEST_BODY_TOO_LARGE",
      statusCode: 413,
      expose: true,
    });
  }

  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new ApplicationError("O corpo da solicitação excede o limite permitido.", {
          code: "REQUEST_BODY_TOO_LARGE",
          statusCode: 413,
          expose: true,
        });
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalidJson();
  }

  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw invalidJson();
  }
}

export function requestClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const identifier = forwarded || request.headers.get("x-real-ip") || "local-client";
  return createHash("sha256").update(identifier).digest("hex").slice(0, 24);
}

export function enforceLocalRateLimit(
  namespace: string,
  subject: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): void {
  const key = `${namespace}:${subject}`;
  const current = rateLimitStore.get(key);
  if (!current || current.resetsAt <= now) {
    rateLimitStore.set(key, { count: 1, resetsAt: now + policy.windowMs });
    return;
  }
  if (current.count >= policy.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetsAt - now) / 1_000));
    throw new ApplicationError("Muitas solicitações. Aguarde antes de tentar novamente.", {
      code: "RATE_LIMITED",
      statusCode: 429,
      expose: true,
      responseHeaders: { "Retry-After": String(retryAfterSeconds) },
    });
  }
  current.count += 1;
}

export async function enforceRateLimit(
  namespace: string,
  subject: string,
  policy: RateLimitPolicy,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (environment.APP_ENV !== "staging" && environment.APP_ENV !== "production") {
    enforceLocalRateLimit(namespace, subject, policy);
    return;
  }

  const result = await getSharedRateLimiter().consume(namespace, subject, policy);
  if (!result.allowed) {
    throw new ApplicationError("Muitas solicitações. Aguarde antes de tentar novamente.", {
      code: "RATE_LIMITED",
      statusCode: 429,
      expose: true,
      responseHeaders: { "Retry-After": String(result.retryAfterSeconds) },
    });
  }
}

export async function clearRateLimit(
  namespace: string,
  subject: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  if (environment.APP_ENV !== "staging" && environment.APP_ENV !== "production") {
    clearLocalRateLimit(namespace, subject);
    return;
  }
  await getSharedRateLimiter().clear(namespace, subject);
}

export function clearLocalRateLimit(namespace: string, subject: string): void {
  rateLimitStore.delete(`${namespace}:${subject}`);
}

export function clearLocalRateLimitsForTests(): void {
  rateLimitStore.clear();
}
