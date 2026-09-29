import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationError } from "@/shared/core/errors/application-error";
import {
  clearLocalRateLimitsForTests,
  clearLocalRateLimit,
  createSharedRateLimiter,
  enforceLocalRateLimit,
  readLimitedJson,
  requestClientKey,
} from "@/shared/core/http/request-hardening";

describe("proteções locais de requisição", () => {
  beforeEach(() => clearLocalRateLimitsForTests());

  it("lê JSON válido dentro do limite", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "RUN" }),
    });

    await expect(readLimitedJson(request, 1_024)).resolves.toEqual({ action: "RUN" });
  });

  it("rejeita mídia, JSON inválido e corpo acima do limite", async () => {
    await expect(readLimitedJson(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }), 10)).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", statusCode: 415 });

    await expect(readLimitedJson(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }), 10)).rejects.toMatchObject({ code: "INVALID_JSON_BODY", statusCode: 400 });

    await expect(readLimitedJson(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "muito grande" }),
    }), 8)).rejects.toMatchObject({ code: "REQUEST_BODY_TOO_LARGE", statusCode: 413 });
  });

  it("limita por janela, informa Retry-After e volta a aceitar após o reset", () => {
    const policy = { limit: 2, windowMs: 10_000 };
    enforceLocalRateLimit("test", "member", policy, 1_000);
    enforceLocalRateLimit("test", "member", policy, 1_001);

    let failure: unknown;
    try {
      enforceLocalRateLimit("test", "member", policy, 1_002);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ApplicationError);
    expect(failure).toMatchObject({
      code: "RATE_LIMITED",
      statusCode: 429,
      responseHeaders: { "Retry-After": "10" },
    });

    expect(() => enforceLocalRateLimit("test", "member", policy, 11_000)).not.toThrow();
  });

  it("remove o contador após uma autenticação concluída", () => {
    const policy = { limit: 1, windowMs: 10_000 };
    enforceLocalRateLimit("login", "client", policy, 1_000);
    clearLocalRateLimit("login", "client");
    expect(() => enforceLocalRateLimit("login", "client", policy, 1_001)).not.toThrow();
  });

  it("gera identificador estável sem registrar o endereço do cliente", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.5, 127.0.0.1" },
    });
    const key = requestClientKey(request);

    expect(key).toHaveLength(24);
    expect(key).not.toContain("203.0.113.5");
    expect(requestClientKey(request)).toBe(key);
  });

  it("usa o contador compartilhado sem expor o sujeito e permite limpeza explícita", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ requestCount: 1, expiresAt: new Date("2026-09-14T19:01:00.000Z") }])
      .mockResolvedValueOnce([{ requestCount: 2, expiresAt: new Date("2026-09-14T19:01:00.000Z") }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const limiter = createSharedRateLimiter(
      { $queryRaw: queryRaw, $executeRaw: executeRaw } as never,
      () => new Date("2026-09-14T19:00:00.000Z"),
    );

    await expect(limiter.consume("login", "203.0.113.7", { limit: 1, windowMs: 60_000 }))
      .resolves.toMatchObject({ allowed: true, remaining: 0, retryAfterSeconds: 0 });
    await expect(limiter.consume("login", "203.0.113.7", { limit: 1, windowMs: 60_000 }))
      .resolves.toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    await limiter.clear("login", "203.0.113.7");

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(JSON.stringify(queryRaw.mock.calls)).not.toContain("203.0.113.7");
  });

  it("recusa namespace ou janela inseguros antes de consultar o banco", async () => {
    const queryRaw = vi.fn();
    const limiter = createSharedRateLimiter(
      { $queryRaw: queryRaw, $executeRaw: vi.fn() } as never,
    );

    await expect(limiter.consume("../../public", "subject", { limit: 1, windowMs: 60_000 }))
      .rejects.toMatchObject({ code: "INVALID_RATE_LIMIT_POLICY" });
    await expect(limiter.consume("login", "subject", { limit: 1, windowMs: 10 }))
      .rejects.toMatchObject({ code: "INVALID_RATE_LIMIT_POLICY" });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
