import { describe, expect, it } from "vitest";

import { parseStagingWorkerHomologationEnvironment } from "@/modules/automations/application/staging-worker-homologation-service";

const stagingHost = ["example-pooler", "sa-east-1", "aws", "neon", "tech"].join(".");
const stagingDatabaseUrl = [
  "postgresql:/",
  `/runtime:secret@${stagingHost}`,
  "/politizai_staging?schema=public&sslmode=require",
].join("");
const valid = {
  APP_ENV: "staging",
  NODE_ENV: "production",
  PROCESS_ROLE: "worker",
  APP_CANONICAL_URL: "https://crm-politizai-staging.vercel.app",
  APP_TRUSTED_HOSTS: "crm-politizai-staging.vercel.app",
  APP_TRUSTED_ORIGINS: "https://crm-politizai-staging.vercel.app",
  APP_TIME_ZONE: "America/Sao_Paulo",
  DATABASE_URL: stagingDatabaseUrl,
  DATABASE_EXPECTED_HOST: stagingHost,
  DATABASE_EXPECTED_NAME: "politizai_staging",
  DATABASE_EXPECTED_SCHEMA: "public",
  SESSION_COOKIE_SECURE: "true",
  SESSION_COOKIE_HTTP_ONLY: "true",
  SESSION_COOKIE_SAME_SITE: "lax",
  LOG_FORMAT: "json",
  AUTOMATION_WORKER_ENABLED: "true",
  EXTERNAL_ADAPTERS_MODE: "disabled",
  DEMO_SEED_ENABLED: "false",
  DEMO_CREDENTIALS_ENABLED: "false",
  DEMO_DATA_MODE: "disabled",
  ADMIN_BOOTSTRAP_ENABLED: "false",
  STAGING_WORKER_HOMOLOGATION_CONFIRMATION: "RUN_TRANSIENT_STAGING_WORKER",
  STAGING_WORKER_HOMOLOGATION_WORKSPACE_SLUG: "politizai-staging",
};

describe("homologação temporária do worker em staging", () => {
  it("aceita somente o alvo Neon de staging confirmado", () => {
    expect(parseStagingWorkerHomologationEnvironment(valid)).toEqual({
      workspaceSlug: "politizai-staging",
    });
  });

  it.each([
    ["produção", { APP_ENV: "production" }, "APP_ENV"],
    ["worker desligado", { AUTOMATION_WORKER_ENABLED: "false" }, "AUTOMATION_WORKER_ENABLED"],
    ["egress habilitado", { EXTERNAL_ADAPTERS_MODE: "local" }, "EXTERNAL_ADAPTERS_MODE"],
    ["banco inesperado", { DATABASE_EXPECTED_NAME: "politizai" }, "DATABASE_EXPECTED_NAME"],
    ["confirmação ausente", { STAGING_WORKER_HOMOLOGATION_CONFIRMATION: undefined }, "STAGING_WORKER_HOMOLOGATION_CONFIRMATION"],
  ])("bloqueia %s sem exibir segredo", (_label, override, variable) => {
    let error: unknown;
    try {
      parseStagingWorkerHomologationEnvironment({ ...valid, ...override });
    } catch (cause) {
      error = cause;
    }
    expect(String(error)).toContain(variable);
    expect(String(error)).not.toContain("runtime:secret");
  });
});
