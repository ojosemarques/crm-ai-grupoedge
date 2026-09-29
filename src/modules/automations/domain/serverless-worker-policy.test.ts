import { describe, expect, it } from "vitest";

import {
  assertServerlessWorkerEnabled,
  assertServerlessWorkerRequest,
  loadServerlessWorkerPolicy,
} from "@/modules/automations/domain/serverless-worker-policy";

const environment = {
  APP_ENV: "staging",
  EXTERNAL_ADAPTERS_MODE: "disabled",
  SERVERLESS_WORKER_ENABLED: "true",
  SERVERLESS_WORKER_SECRET: "a".repeat(48),
  SERVERLESS_WORKER_MAX_JOBS: "10",
  SERVERLESS_WORKER_MAX_DURATION_MS: "40000",
};

describe("serverless worker policy", () => {
  it("aceita configuração restrita de staging", () => {
    expect(loadServerlessWorkerPolicy(environment)).toEqual({
      enabled: true,
      secret: "a".repeat(48),
      maxJobs: 10,
      maxDurationMs: 40_000,
    });
  });

  it.each([
    ["kill switch inválido", { SERVERLESS_WORKER_ENABLED: "invalid" }, "SERVERLESS_WORKER_ENABLED"],
    ["segredo curto", { SERVERLESS_WORKER_SECRET: "short" }, "SERVERLESS_WORKER_SECRET"],
    ["lote excessivo", { SERVERLESS_WORKER_MAX_JOBS: "26" }, "SERVERLESS_WORKER_MAX_JOBS"],
    ["duração excessiva", { SERVERLESS_WORKER_MAX_DURATION_MS: "45001" }, "SERVERLESS_WORKER_MAX_DURATION_MS"],
    ["egress", { EXTERNAL_ADAPTERS_MODE: "mock" }, "EXTERNAL_ADAPTERS_MODE"],
  ])("rejeita %s", (_label, change, expected) => {
    expect(() => loadServerlessWorkerPolicy({ ...environment, ...change })).toThrow(expected);
  });

  it("bloqueia processamento pelo kill switch sem invalidar a configuração", () => {
    const policy = loadServerlessWorkerPolicy({ ...environment, SERVERLESS_WORKER_ENABLED: "false" });
    expect(policy.enabled).toBe(false);
    expect(() => assertServerlessWorkerEnabled(policy)).toThrow(/kill switch/i);
  });

  it("autentica somente Bearer no header e rejeita query string", () => {
    const policy = loadServerlessWorkerPolicy(environment);
    expect(() => assertServerlessWorkerRequest(new Request("https://staging.example/api/internal/worker/tick", {
      method: "POST",
      headers: { authorization: `Bearer ${environment.SERVERLESS_WORKER_SECRET}` },
    }), policy)).not.toThrow();
    expect(() => assertServerlessWorkerRequest(new Request("https://staging.example/api/internal/worker/tick?secret=hidden", {
      method: "POST",
      headers: { authorization: `Bearer ${environment.SERVERLESS_WORKER_SECRET}` },
    }), policy)).toThrow(/query string/i);
    expect(() => assertServerlessWorkerRequest(new Request("https://staging.example/api/internal/worker/tick", {
      method: "POST",
      headers: { authorization: "Bearer invalid" },
    }), policy)).toThrow(/Credencial interna inválida/);
  });
});
