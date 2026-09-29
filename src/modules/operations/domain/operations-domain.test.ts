import { describe, expect, it } from "vitest";
import { operationsListQuerySchema } from "@/modules/operations/domain/operations-contracts";
import { sanitizeMetricLabels, redactTelemetryValue } from "@/modules/operations/domain/redaction";
import { calculateSlo } from "@/modules/operations/domain/slo";
import { createLocalRateLimiter } from "@/modules/operations/domain/rate-limit";
import { assertSafeOperationalRuntime } from "@/modules/operations/domain/runtime-guards";

describe("operações: contratos seguros", () => {
  it("remove segredos e PII antes do sink", () => {
    const value = redactTelemetryValue({ password: "abc", email: "pessoa@example.com", workspaceId: "workspace-real", nested: { authorization: "Bearer abc.def" }, errorName: "ApplicationError", safe: "ok", detail: "Falha em postgresql://user:pass@db.example/app?sslmode=require com session=abc123" }) as Record<string, unknown>;
    expect(value.password).toBe("[REMOVIDO]");
    expect(value.email).toBe("[REMOVIDO]");
    expect(value.workspaceId).toMatch(/^ws_\d{10}$/);
    expect(value.workspaceId).not.toBe("workspace-real");
    expect(value.nested).toEqual({ authorization: "[REMOVIDO]" });
    expect(value.errorName).toBe("ApplicationError");
    expect(value.safe).toBe("ok");
    expect(value.detail).toBe("Falha em [REMOVIDO] com [REMOVIDO]");
  });

  it("recusa labels com PII ou cardinalidade livre", () => {
    expect(sanitizeMetricLabels({ route: "/api/leads", method: "GET" })).toEqual({ route: "/api/leads", method: "GET" });
    expect(() => sanitizeMetricLabels({ email: "a@b.com" })).toThrow("TELEMETRY_LABEL_NOT_ALLOWED");
    expect(() => sanitizeMetricLabels({ route: "5511999999999" })).toThrow("HIGH_CARDINALITY");
  });

  it("calcula conformidade e burn rate sem inventar divisão por zero", () => {
    expect(calculateSlo({ good: 0, total: 0, targetBasisPoints: 9900 }).state).toBe("NO_DATA");
    const breached = calculateSlo({ good: 90, total: 100, targetBasisPoints: 9900 });
    expect(breached.complianceBasisPoints).toBe(9000);
    expect(breached.burnRate).toBe(10);
    expect(breached.state).toBe("BREACHED");
  });

  it("aplica limite local determinístico com janela", () => {
    let time = 0;
    const limiter = createLocalRateLimiter({ limit: 2, windowMs: 1_000, now: () => time });
    expect(limiter.consume("workspace:actor").allowed).toBe(true);
    expect(limiter.consume("workspace:actor").allowed).toBe(true);
    expect(limiter.consume("workspace:actor").allowed).toBe(false);
    time = 1_001;
    expect(limiter.consume("workspace:actor").allowed).toBe(true);
  });

  it("mantém a consulta paginada estrita e limitada", () => {
    expect(operationsListQuerySchema.parse({ page: "2", pageSize: "50", tab: "security" })).toEqual({ page: 2, pageSize: 50, tab: "security" });
    expect(() => operationsListQuerySchema.parse({ page: "1", pageSize: "500", tab: "privacy" })).toThrow();
    expect(() => operationsListQuerySchema.parse({ page: "1", pageSize: "25", tab: "privacy", workspaceId: "outro" })).toThrow();
  });

  it("permite somente banco local por padrão", () => {
    expect(assertSafeOperationalRuntime({ NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/politizai_crm" })).toEqual({ localDatabase: true, externalAdapters: false });
    expect(() => assertSafeOperationalRuntime({ NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@remote.example:5432/politizai_crm" })).toThrowError("Banco remoto bloqueado");
  });

  it("aceita staging remoto somente quando o contrato completo identifica o alvo", () => {
    const staging = {
      APP_ENV: "staging",
      NODE_ENV: "production",
      PROCESS_ROLE: "web",
      APP_CANONICAL_URL: "https://crm-staging.example.com",
      APP_TRUSTED_HOSTS: "crm-staging.example.com",
      APP_TRUSTED_ORIGINS: "https://crm-staging.example.com",
      APP_TIME_ZONE: "America/Sao_Paulo",
      DATABASE_URL: ["postgresql:", "//runtime:fixture@pool.staging.example.com:5432/politizai_staging?sslmode=require&schema=public"].join(""),
      DATABASE_EXPECTED_HOST: "pool.staging.example.com",
      DATABASE_EXPECTED_NAME: "politizai_staging",
      DATABASE_EXPECTED_SCHEMA: "public",
      SESSION_COOKIE_SECURE: "true",
      SESSION_COOKIE_HTTP_ONLY: "true",
      SESSION_COOKIE_SAME_SITE: "lax",
      LOG_FORMAT: "json",
      AUTOMATION_WORKER_ENABLED: "false",
      EXTERNAL_ADAPTERS_MODE: "disabled",
      DEMO_SEED_ENABLED: "false",
      DEMO_CREDENTIALS_ENABLED: "false",
      DEMO_DATA_MODE: "disabled",
      ADMIN_BOOTSTRAP_ENABLED: "false",
    } satisfies NodeJS.ProcessEnv;

    expect(assertSafeOperationalRuntime(staging)).toEqual({ localDatabase: false, externalAdapters: false });
    expect(() => assertSafeOperationalRuntime({ ...staging, DATABASE_EXPECTED_HOST: "outro.example.com" }))
      .toThrowError("Configuração operacional remota insegura");
  });

  it("bloqueia adapters externos", () => {
    expect(() => assertSafeOperationalRuntime({ NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@db:5432/politizai_crm", EMAIL_PROVIDER_MODE: "production" })).toThrowError("Adapter externo bloqueado");
    expect(assertSafeOperationalRuntime({ NODE_ENV: "test", DATABASE_URL: "postgresql://user:pass@db:5432/politizai_crm", EMAIL_PROVIDER_MODE: "simulated" })).toEqual({ localDatabase: true, externalAdapters: false });
  });
});
