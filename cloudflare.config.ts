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
  CLOUDFLARE_CRON_ENABLED: "false",
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
  META_ADS_CONVERSIONS_DIAGNOSTICS_ENABLED: "false",
  META_ADS_CONVERSIONS_WORKER_ENABLED: "false",
  META_ADS_DATASET_ID: "26525824360406160",
  META_ADS_SERVER_CREDENTIALS_ENABLED: "true",
  MILLIONSEND_ENABLED: "true",
  NODE_ENV: "production",
  PROCESS_ROLE: "web",
  REALTIME_PUBLIC_WORKSPACE_SLUG: "",
  SERVERLESS_WORKER_ENABLED: "false",
  SERVERLESS_WORKER_MAX_DURATION_MS: "40000",
  SERVERLESS_WORKER_MAX_JOBS: "10",
  SESSION_COOKIE_HTTP_ONLY: "true",
  SESSION_COOKIE_SAME_SITE: "lax",
  SESSION_COOKIE_SECURE: "true",
  TELEGRAM_ENABLED: "true",
  TOPSEND_VOICE_ENABLED: "false",
} as const;

const runtimeSecrets = [
  "DATABASE_URL",
  "META_ADS_ACCESS_TOKEN",
  "MILLIONSEND_API_KEY",
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
