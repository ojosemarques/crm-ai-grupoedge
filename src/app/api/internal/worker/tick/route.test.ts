import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const disconnect = vi.fn();

vi.mock("@/modules/automations/application/worker-runtime", () => ({
  createDefaultWorkerBatchRunner: () => ({
    database: { $disconnect: disconnect },
    runner: { run },
  }),
}));

vi.mock("@/shared/core/config/application-config", () => ({
  getApplicationConfig: () => ({}),
}));

const validEnvironment = {
  APP_ENV: "staging",
  EXTERNAL_ADAPTERS_MODE: "disabled",
  SERVERLESS_WORKER_ENABLED: "true",
  SERVERLESS_WORKER_SECRET: "s".repeat(48),
  SERVERLESS_WORKER_MAX_JOBS: "7",
  SERVERLESS_WORKER_MAX_DURATION_MS: "35000",
};

function request(options: Readonly<{ authorization?: string; query?: string }> = {}) {
  return new Request(`https://staging.example/api/internal/worker/tick${options.query ?? ""}`, {
    method: "POST",
    headers: {
      ...(options.authorization ? { authorization: options.authorization } : {}),
      "x-correlation-id": "prod10-worker-test",
    },
  });
}

describe("POST /api/internal/worker/tick", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", validEnvironment.APP_ENV);
    vi.stubEnv("EXTERNAL_ADAPTERS_MODE", validEnvironment.EXTERNAL_ADAPTERS_MODE);
    vi.stubEnv("SERVERLESS_WORKER_ENABLED", validEnvironment.SERVERLESS_WORKER_ENABLED);
    vi.stubEnv("SERVERLESS_WORKER_SECRET", validEnvironment.SERVERLESS_WORKER_SECRET);
    vi.stubEnv("SERVERLESS_WORKER_MAX_JOBS", validEnvironment.SERVERLESS_WORKER_MAX_JOBS);
    vi.stubEnv("SERVERLESS_WORKER_MAX_DURATION_MS", validEnvironment.SERVERLESS_WORKER_MAX_DURATION_MS);
    run.mockResolvedValue({
      code: "BATCH_COMPLETED",
      processed: 1,
      published: 0,
      elapsedMs: 12,
      outcomes: { "automations:SUCCEEDED": 1 },
    });
    disconnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("processa um lote autenticado com limites configurados e resposta agregada", async () => {
    const { POST } = await import("@/app/api/internal/worker/tick/route");
    const response = await POST(request({ authorization: `Bearer ${validEnvironment.SERVERLESS_WORKER_SECRET}` }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("prod10-worker-test");
    await expect(response.json()).resolves.toEqual({
      code: "BATCH_COMPLETED",
      processed: 1,
      published: 0,
      elapsedMs: 12,
      outcomes: { "automations:SUCCEEDED": 1 },
      correlationId: "prod10-worker-test",
    });
    expect(run).toHaveBeenCalledWith({
      workerId: "serverless:prod10-worker-test",
      maxJobs: 7,
      maxDurationMs: 35_000,
    });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    ["ausência de Authorization", undefined],
    ["segredo incorreto", "Bearer incorreto"],
  ])("rejeita %s sem abrir conexão", async (_label, authorization) => {
    const { POST } = await import("@/app/api/internal/worker/tick/route");
    const response = await POST(request(authorization ? { authorization } : {}));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "WORKER_UNAUTHENTICATED" } });
    expect(run).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("rejeita query string sem abrir conexão", async () => {
    const { POST } = await import("@/app/api/internal/worker/tick/route");
    const response = await POST(request({
      authorization: `Bearer ${validEnvironment.SERVERLESS_WORKER_SECRET}`,
      query: "?secret=proibido",
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "WORKER_QUERY_NOT_ALLOWED" } });
    expect(run).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("retorna 503 no kill switch sem tratar a configuração como inválida", async () => {
    vi.stubEnv("SERVERLESS_WORKER_ENABLED", "false");
    const { POST } = await import("@/app/api/internal/worker/tick/route");
    const response = await POST(request({ authorization: `Bearer ${validEnvironment.SERVERLESS_WORKER_SECRET}` }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "WORKER_DISABLED" } });
    expect(run).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("fecha o pool quando o lote falha e não expõe o erro interno", async () => {
    run.mockRejectedValueOnce(new Error("payload privado que não pode sair"));
    const { POST } = await import("@/app/api/internal/worker/tick/route");
    const response = await POST(request({ authorization: `Bearer ${validEnvironment.SERVERLESS_WORKER_SECRET}` }));
    expect(response.status).toBe(500);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", message: "Não foi possível concluir a solicitação." });
    expect(JSON.stringify(body)).not.toContain("payload privado");
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
