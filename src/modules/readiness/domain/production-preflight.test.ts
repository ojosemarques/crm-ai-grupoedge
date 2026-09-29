import { describe, expect, it } from "vitest";

import { evaluateProductionPreflight } from "@/modules/readiness/domain/production-preflight";

const local = {
  APP_ENV: "local",
  APP_TIME_ZONE: "America/Sao_Paulo",
  DATABASE_URL: "postgresql://user:local-example@localhost:5432/politizai_crm?schema=public",
  NODE_ENV: "development",
};

const remote = {
  APP_ENV: "staging",
  NODE_ENV: "production",
  PROCESS_ROLE: "web",
  APP_CANONICAL_URL: "https://crm-politizai-staging.example.com",
  APP_TRUSTED_HOSTS: "crm-politizai-staging.example.com",
  APP_TRUSTED_ORIGINS: "https://crm-politizai-staging.example.com",
  APP_TIME_ZONE: "America/Sao_Paulo",
  DATABASE_URL: "postgresql://runtime:not-printed@pool.staging.example/politizai_staging?schema=public&sslmode=require",
  DATABASE_EXPECTED_HOST: "pool.staging.example",
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
};

describe("PROD-03: preflight de nuvem", () => {
  it("mantém banco remoto proibido no gate local", () => {
    expect(evaluateProductionPreflight(local, { nodeVersion: "v22.23.1" }).decision).toBe("READY_FOR_LOCAL");
    const report = evaluateProductionPreflight({ ...local, DATABASE_URL: remote.DATABASE_URL }, { nodeVersion: "v22.23.1" });
    expect(report.decision).toBe("BLOCKED");
  });

  it("distingue staging e produção sem revelar credenciais", () => {
    const staging = evaluateProductionPreflight(remote, { nodeVersion: "v22.23.1", target: "staging" });
    expect(staging.decision).toBe("READY_FOR_STAGING");
    expect(JSON.stringify(staging)).not.toContain("not-printed");

    const productionEnvironment = Object.fromEntries(Object.entries(remote).map(([key, value]) => [key, value.replaceAll("staging", "production")]));
    const production = evaluateProductionPreflight(productionEnvironment, { nodeVersion: "v22.23.1", target: "production" });
    expect(production.decision).toBe("READY_FOR_PRODUCTION");
  });

  it.each([
    ["URL direta exposta ao web", { ...remote, DIRECT_URL: "postgresql://migration:not-printed@direct.staging.example/politizai_staging?schema=public&sslmode=require" }],
    ["origem insegura", { ...remote, APP_CANONICAL_URL: "http://crm-politizai-staging.example.com" }],
    ["demo habilitada", { ...remote, DEMO_CREDENTIALS_ENABLED: "true" }],
    ["adapter real", { ...remote, EMAIL_PROVIDER_MODE: "production" }],
    ["segredo público", { ...remote, NEXT_PUBLIC_API_TOKEN: "not-printed" }],
  ])("bloqueia %s sem ecoar valor", (_label, environment) => {
    const report = evaluateProductionPreflight(environment, { nodeVersion: "22.23.1", target: "staging" });
    expect(report.decision).toBe("BLOCKED");
    expect(JSON.stringify(report)).not.toContain("not-printed");
  });
});
