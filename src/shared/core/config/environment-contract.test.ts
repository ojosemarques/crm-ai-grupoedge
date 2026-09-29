import { describe, expect, it } from "vitest";

import { loadEnvironmentContract } from "@/shared/core/config/environment-contract";

const local = {
  APP_ENV: "local",
  DATABASE_URL: "postgresql://user:password@localhost:5432/politizai_crm?schema=public",
  NODE_ENV: "development",
};

const staging = {
  APP_ENV: "staging",
  NODE_ENV: "production",
  PROCESS_ROLE: "web",
  APP_CANONICAL_URL: "https://crm-politizai-staging.example.com",
  APP_TRUSTED_HOSTS: "crm-politizai-staging.example.com",
  APP_TRUSTED_ORIGINS: "https://crm-politizai-staging.example.com",
  APP_TIME_ZONE: "America/Sao_Paulo",
  DATABASE_URL: "postgresql://runtime:secret@pool.staging.example/politizai_staging?schema=public&sslmode=require",
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

describe("contrato de ambiente PROD-03", () => {
  it("aceita defaults seguros somente para desenvolvimento local", () => {
    const result = loadEnvironmentContract(local);
    expect(result.APP_ENV).toBe("local");
    expect(result.DIRECT_URL).toBe(local.DATABASE_URL);
    expect(result.isRemote).toBe(false);
  });

  it("aceita staging web explícito com conexão pooled e TLS", () => {
    const result = loadEnvironmentContract(staging);
    expect(result.APP_ENV).toBe("staging");
    expect(result.isRemote).toBe(true);
    expect(result.trustedOrigins).toEqual([staging.APP_CANONICAL_URL]);
  });

  it("não aplica defaults silenciosos em staging", () => {
    const withoutExplicitAdapterMode = Object.fromEntries(
      Object.entries(staging).filter(([name]) => name !== "EXTERNAL_ADAPTERS_MODE"),
    );
    expect(() => loadEnvironmentContract(withoutExplicitAdapterMode)).toThrow(/EXTERNAL_ADAPTERS_MODE/);
  });

  it.each([
    ["sem HTTPS", { ...staging, APP_CANONICAL_URL: "http://crm-politizai-staging.example.com" }, "APP_CANONICAL_URL"],
    ["host inesperado", { ...staging, DATABASE_EXPECTED_HOST: "outro.example" }, "DATABASE_EXPECTED_HOST"],
    ["sem TLS", { ...staging, DATABASE_URL: "postgresql://runtime:secret@pool.staging.example/politizai_staging?schema=public" }, "DATABASE_URL"],
    ["seed demo", { ...staging, DEMO_SEED_ENABLED: "true" }, "DEMO_SEED_ENABLED"],
    ["adapter real", { ...staging, EMAIL_PROVIDER_MODE: "production" }, "EMAIL_PROVIDER_MODE"],
    ["segredo público", { ...staging, NEXT_PUBLIC_API_TOKEN: "secret-value" }, "NEXT_PUBLIC_API_TOKEN"],
  ])("bloqueia %s sem ecoar valores", (_label, environment, variable) => {
    let failure: unknown;
    try { loadEnvironmentContract(environment); } catch (error) { failure = error; }
    expect(String(failure)).toContain(variable);
    expect(String(failure)).not.toContain("secret-value");
  });

  it("exige DIRECT_URL distinta somente no papel de migration", () => {
    expect(loadEnvironmentContract({
      ...staging,
      PROCESS_ROLE: "migration",
      DIRECT_URL: "postgresql://migration:secret@direct.staging.example/politizai_staging?schema=public&sslmode=require",
      DATABASE_EXPECTED_DIRECT_HOST: "direct.staging.example",
    }).directUrl?.hostname).toBe("direct.staging.example");
    expect(() => loadEnvironmentContract({ ...staging, PROCESS_ROLE: "migration" })).toThrow(/DIRECT_URL/);
  });

  it("exige ativação explícita apenas no processo worker", () => {
    expect(() => loadEnvironmentContract({ ...staging, PROCESS_ROLE: "worker" })).toThrow(/AUTOMATION_WORKER_ENABLED/);
    expect(loadEnvironmentContract({
      ...staging,
      PROCESS_ROLE: "worker",
      AUTOMATION_WORKER_ENABLED: "true",
    }).PROCESS_ROLE).toBe("worker");
  });

  it("proíbe banco remoto em local mesmo com override legado", () => {
    expect(() => loadEnvironmentContract({
      ...local,
      ALLOW_REMOTE_DATABASE: "1",
      DATABASE_URL: staging.DATABASE_URL,
      DIRECT_URL: "postgresql://migration:secret@direct.staging.example/politizai_staging?schema=public&sslmode=require",
    })).toThrow();
  });
});
