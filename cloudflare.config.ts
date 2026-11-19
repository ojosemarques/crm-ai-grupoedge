import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

const hyperdriveId = process.env.CLOUDFLARE_HYPERDRIVE_ID?.trim();
if (!hyperdriveId) {
  throw new Error("CLOUDFLARE_HYPERDRIVE_ID é obrigatória para build e deploy Cloudflare.");
}

const runtimeVariables = {
  APP_CANONICAL_URL: "https://crm.edgegrupo.com",
  APP_ENV: "production",
  APP_NAME: "Grupo Edge CRM",
  APP_TIME_ZONE: "America/Sao_Paulo",
  APP_TRUSTED_HOSTS: "crm.edgegrupo.com,grupo-edge-crm.grupo-edge-voukye.workers.dev",
  APP_TRUSTED_ORIGINS: "https://crm.edgegrupo.com,https://grupo-edge-crm.grupo-edge-voukye.workers.dev",
  ADMIN_BOOTSTRAP_ENABLED: "false",
  AUTOMATION_WORKER_ENABLED: "false",
  CLOUDFLARE_CRON_ENABLED: "true",
  COPILOT_EXTERNAL_ENABLED: "false",
  DATABASE_EXPECTED_HOST: "db.zbzztpzviyjxpprqcegs.supabase.co",
  DATABASE_EXPECTED_NAME: "postgres",
  DATABASE_EXPECTED_SCHEMA: "crm",
  DEMO_CREDENTIALS_ENABLED: "false",
  DEMO_DATA_MODE: "disabled",
  DEMO_SEED_ENABLED: "false",
  EXTERNAL_ADAPTERS_MODE: "disabled",
  LOG_FORMAT: "json",
  LOG_LEVEL: "info",
  META_ADS_CONVERSIONS_UPSTREAM_PRIVACY: "true",
  META_ADS_CONVERSIONS_DIAGNOSTICS_ENABLED: "false",
  META_ADS_CONVERSIONS_WORKER_ENABLED: "true",
  META_ADS_DATASET_ID: "26525824360406160",
  META_ADS_NATIVE_BUSINESS_ID: "1484709821933266",
  META_ADS_NATIVE_PAGE_ID: "931101203422256",
  META_ADS_NATIVE_WORKSPACE_ID: "f99613d9-f4a1-449e-a19f-ed9ec3d46105",
  META_ADS_REPORTING_ACCOUNT_IDS: "act_1415753425825296,act_857477559328413",
  META_ADS_REPORTING_BUSINESS_ID: "845842476916719",
  META_ADS_REPORTING_WORKSPACE_ID: "f99613d9-f4a1-449e-a19f-ed9ec3d46105",
  META_ADS_SERVER_CREDENTIALS_ENABLED: "true",
  MILLIONSEND_ENABLED: "true",
  NODE_ENV: "production",
  PROCESS_ROLE: "web",
  REALTIME_PUBLIC_WORKSPACE_SLUG: "",
  SERVERLESS_WORKER_ENABLED: "true",
  SERVERLESS_WORKER_MAX_DURATION_MS: "40000",
  SERVERLESS_WORKER_MAX_JOBS: "1",
  SESSION_COOKIE_HTTP_ONLY: "true",
  SESSION_COOKIE_SAME_SITE: "lax",
  SESSION_COOKIE_SECURE: "true",
  TELEGRAM_ENABLED: "true",
  TOPSEND_VOICE_ENABLED: "false",
} as const;

const runtimeSecrets = [
  "CRM_MCP_CLIENTS_JSON",
  "CRM_MCP_OAUTH_SIGNING_SECRET",
  "DATABASE_URL",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
  "META_ADS_ACCESS_TOKEN",
  "META_ADS_APP_SECRET",
  "META_ADS_NATIVE_ACCESS_TOKEN",
  "META_ADS_NATIVE_APP_SECRET",
  "META_ADS_NATIVE_CONVERSION_TOKEN",
  "META_ADS_NATIVE_VERIFY_TOKEN",
  "META_ADS_REPORTING_ACCESS_TOKEN",
  "META_ADS_REPORTING_APP_SECRET",
  "META_ADS_WEBHOOK_VERIFY_TOKEN",
  "MILLIONSEND_API_KEY",
  "MILLIONSEND_WEBHOOK_SECRET",
  "SERVERLESS_WORKER_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
] as const;

const secretBindings = Object.fromEntries(
  runtimeSecrets.map((name) => [name, bindings.secret()]),
);
const textBindings = Object.fromEntries(
  Object.entries(runtimeVariables).map(([name, value]) => [name, bindings.text(value)]),
);

export default defineConfig({
  accountId: "98ae8074cd2813cbf3a211c0dd7a8c16",
  worker: defineWorker({
    name: "grupo-edge-crm",
    entrypoint: "./worker/index.ts",
    compatibilityDate: "2026-11-16",
    compatibilityFlags: ["nodejs_compat"],
    placement: { region: "aws:ca-central-1" },
    observability: {
      enabled: true,
      redactQueryString: true,
      issues: { enabled: true },
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: true,
        persist: true,
      },
      traces: {
        enabled: true,
        headSamplingRate: 0.1,
        persist: true,
      },
    },
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ...secretBindings,
      ...textBindings,
      ASSETS: bindings.assets(),
      HYPERDRIVE: bindings.hyperdrive({ id: hyperdriveId }),
    },
  }),
});
