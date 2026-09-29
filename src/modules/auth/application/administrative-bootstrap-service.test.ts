import { describe, expect, it } from "vitest";

import { parseAdministrativeBootstrapEnvironment } from "@/modules/auth/application/administrative-bootstrap-service";

const base = {
  APP_ENV: "staging",
  NODE_ENV: "production",
  PROCESS_ROLE: "bootstrap",
  APP_CANONICAL_URL: "https://crm-staging.example",
  APP_TRUSTED_HOSTS: "crm-staging.example",
  APP_TRUSTED_ORIGINS: "https://crm-staging.example",
  APP_TIME_ZONE: "America/Sao_Paulo",
  DATABASE_URL: "postgresql://runtime:hidden@pool.example/crm_staging?schema=public&sslmode=require",
  DATABASE_EXPECTED_HOST: "pool.example",
  DATABASE_EXPECTED_NAME: "crm_staging",
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
  ADMIN_BOOTSTRAP_ENABLED: "true",
  ADMIN_BOOTSTRAP_SECRET: "x".repeat(32),
  ADMIN_BOOTSTRAP_CONFIRMATION: "CREATE_INITIAL_ADMIN",
  ADMIN_BOOTSTRAP_IDEMPOTENCY_KEY: "bootstrap-idempotency-key-001",
  ADMIN_BOOTSTRAP_WORKSPACE_SLUG: "politizai",
  ADMIN_BOOTSTRAP_WORKSPACE_NAME: "Politizai",
  ADMIN_BOOTSTRAP_EMAIL: "admin@example.com",
  ADMIN_BOOTSTRAP_DISPLAY_NAME: "Administrador",
  ADMIN_BOOTSTRAP_PASSWORD: "SenhaInicial#2026Segura",
};

describe("bootstrap administrativo PROD-03", () => {
  it("aceita somente execução remota explícita de uso único", () => {
    expect(parseAdministrativeBootstrapEnvironment(base)).toMatchObject({ workspaceSlug: "politizai", adminEmail: "admin@example.com" });
  });

  it.each([
    [{ ...base, ADMIN_BOOTSTRAP_CONFIRMATION: "YES" }, "ADMIN_BOOTSTRAP_CONFIGURATION"],
    [{ ...base, ADMIN_BOOTSTRAP_PASSWORD: "Politizai@Local123" }, "senha inicial"],
    [{ ...base, PROCESS_ROLE: "web" }, "ADMIN_BOOTSTRAP_ENABLED"],
  ])("bloqueia configuração insegura", (environment, expected) => {
    expect(() => parseAdministrativeBootstrapEnvironment(environment)).toThrow(expected);
  });
});
