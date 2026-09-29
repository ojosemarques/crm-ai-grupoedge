import { z } from "zod";

import { ConfigurationError } from "@/shared/core/errors/application-error";
import {
  loadEnvironmentContract,
  type EnvironmentContract,
} from "@/shared/core/config/environment-contract";

const databaseUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "deve ser uma URL PostgreSQL",
  );

const applicationConfigSchema = z.object({
  APP_NAME: z.string().trim().min(1).default("Politizai CRM"),
  APP_TIME_ZONE: z.literal("America/Sao_Paulo").default("America/Sao_Paulo"),
  AUTOMATION_BACKOFF_BASE_SECONDS: z.coerce.number().int().min(1).max(3_600).default(5),
  AUTOMATION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  AUTOMATION_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
  AUTOMATION_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  AUTOMATION_WORKER_ID: z.string().trim().min(3).max(100).default("worker-local-1"),
  AUTH_LOCK_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(8),
  DATABASE_URL: databaseUrlSchema,
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
});

export type ApplicationConfig = Readonly<
  z.infer<typeof applicationConfigSchema> & { environment: EnvironmentContract }
>;

export function loadApplicationConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ApplicationConfig {
  const environment = loadEnvironmentContract(source);
  const result = applicationConfigSchema.safeParse(source);

  if (!result.success) {
    const variableNames = Array.from(
      new Set(
        result.error.issues.map((issue) => String(issue.path.at(0) ?? "desconhecida")),
      ),
    );

    throw new ConfigurationError(variableNames);
  }

  return Object.freeze({ ...result.data, environment });
}

let cachedConfig: ApplicationConfig | undefined;

export function getApplicationConfig(): ApplicationConfig {
  cachedConfig ??= loadApplicationConfig(process.env);
  return cachedConfig;
}
