import { describe, expect, it } from "vitest";

import { parseStagingHomologationEnvironment } from "@/modules/settings/application/staging-homologation-service";

const stagingEnvironment = {
  APP_ENV: "staging",
  NODE_ENV: "production",
  PROCESS_ROLE: "migration",
  APP_CANONICAL_URL: "https://crm-politizai-staging.onrender.com",
  APP_TRUSTED_HOSTS: "crm-politizai-staging.onrender.com",
  APP_TRUSTED_ORIGINS: "https://crm-politizai-staging.onrender.com",
  APP_TIME_ZONE: "America/Sao_Paulo",
  DATABASE_URL: "postgresql://runtime:test-only@" + "pooler.us-east-1.aws.neon.tech/politizai_staging?schema=public&sslmode=verify-full",
  DIRECT_URL: "postgresql://migrator:test-only@" + "direct.us-east-1.aws.neon.tech/politizai_staging?schema=public&sslmode=verify-full",
  DATABASE_EXPECTED_HOST: "pooler.us-east-1.aws.neon.tech",
  DATABASE_EXPECTED_DIRECT_HOST: "direct.us-east-1.aws.neon.tech",
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
  STAGING_HOMOLOGATION_CONFIRMATION: "CREATE_STAGING_SYNTHETIC_DATASET",
  STAGING_HOMOLOGATION_WORKSPACE_SLUG: "politizai-staging",
  STAGING_HOMOLOGATION_CLOSER_PASSWORD: "synthetic-only-password-2050",
} as const;

describe("staging homologation guard", () => {
  it("accepts the explicit staging boundary", () => {
    expect(parseStagingHomologationEnvironment(stagingEnvironment)).toEqual({
      workspaceSlug: "politizai-staging",
      closerPassword: "synthetic-only-password-2050",
    });
  });

  it.each([
    ["production environment", { APP_ENV: "production" }],
    ["wrong database", { DATABASE_EXPECTED_NAME: "politizai_production" }],
    ["wrong schema", { DATABASE_EXPECTED_SCHEMA: "other" }],
    ["missing confirmation", { STAGING_HOMOLOGATION_CONFIRMATION: undefined }],
    ["missing closer password", { STAGING_HOMOLOGATION_CLOSER_PASSWORD: undefined }],
    ["short closer password", { STAGING_HOMOLOGATION_CLOSER_PASSWORD: "too-short" }],
    ["local host", {
      DATABASE_URL: "postgresql://runtime:secret@localhost/politizai_staging?schema=public&sslmode=verify-full",
      DATABASE_EXPECTED_HOST: "localhost",
    }],
  ])("rejects %s", (_label, changes) => {
    expect(() => parseStagingHomologationEnvironment({ ...stagingEnvironment, ...changes })).toThrow();
  });
});
