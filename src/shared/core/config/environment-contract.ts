import { z } from "zod";

import { ConfigurationError } from "@/shared/core/errors/application-error";

export const applicationEnvironments = ["local", "test", "staging", "production"] as const;
export type ApplicationEnvironment = (typeof applicationEnvironments)[number];

export const processRoles = ["web", "worker", "migration", "bootstrap"] as const;
export type ProcessRole = (typeof processRoles)[number];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db"]);
const SECRET_PUBLIC_NAME = /(secret|password|token|private|database|credential|api_?key|direct_url)/i;
const DISABLED_ADAPTER_MODES = new Set(["disabled", "local", "mock", "simulated"]);
const DATABASE_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const EXTERNAL_CREDENTIAL_NAMES = new Set([
  "META_ADS_ACCESS_TOKEN",
  "META_ADS_APP_SECRET",
  "GOOGLE_ADS_OAUTH_CLIENT_ID",
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
  "GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
]);

const booleanString = z.enum(["true", "false"]);
const environmentSchema = z.object({
  APP_ENV: z.enum(applicationEnvironments),
  NODE_ENV: z.enum(["development", "test", "production"]),
  PROCESS_ROLE: z.enum(processRoles),
  APP_CANONICAL_URL: z.string().url(),
  APP_TRUSTED_HOSTS: z.string(),
  APP_TRUSTED_ORIGINS: z.string(),
  APP_TIME_ZONE: z.literal("America/Sao_Paulo"),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  DATABASE_EXPECTED_HOST: z.string(),
  DATABASE_EXPECTED_DIRECT_HOST: z.string().optional(),
  DATABASE_EXPECTED_NAME: z.string(),
  DATABASE_EXPECTED_SCHEMA: z.string(),
  SESSION_COOKIE_SECURE: booleanString,
  SESSION_COOKIE_HTTP_ONLY: z.literal("true"),
  SESSION_COOKIE_SAME_SITE: z.literal("lax"),
  LOG_FORMAT: z.enum(["json", "pretty"]),
  AUTOMATION_WORKER_ENABLED: booleanString,
  EXTERNAL_ADAPTERS_MODE: z.enum(["disabled", "local", "mock", "simulated"]),
  DEMO_SEED_ENABLED: booleanString,
  DEMO_CREDENTIALS_ENABLED: booleanString,
  DEMO_DATA_MODE: z.enum(["disabled", "local"]),
  ADMIN_BOOTSTRAP_ENABLED: booleanString,
});

export type EnvironmentContract = Readonly<z.infer<typeof environmentSchema> & {
  canonicalUrl: URL;
  databaseUrl: URL;
  directUrl: URL | null;
  trustedHosts: readonly string[];
  trustedOrigins: readonly string[];
  isRemote: boolean;
}>;

function splitList(value: string): readonly string[] {
  return Object.freeze(value.split(",").map((item) => item.trim()).filter(Boolean));
}

function parsePostgresUrl(value: string, variableName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError([variableName]);
  }
  if (!DATABASE_PROTOCOLS.has(parsed.protocol)) throw new ConfigurationError([variableName]);
  return parsed;
}

function inferredAppEnvironment(source: Readonly<Record<string, string | undefined>>): ApplicationEnvironment {
  if (source.APP_ENV && applicationEnvironments.includes(source.APP_ENV as ApplicationEnvironment)) {
    return source.APP_ENV as ApplicationEnvironment;
  }
  return source.NODE_ENV === "test" ? "test" : "local";
}

function withSafeLocalDefaults(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const appEnvironment = inferredAppEnvironment(source);
  const local = appEnvironment === "local" || appEnvironment === "test";
  const databaseUrl = source.DATABASE_URL;
  return {
    ...source,
    APP_ENV: appEnvironment,
    NODE_ENV: source.NODE_ENV ?? (local ? (appEnvironment === "test" ? "test" : "development") : undefined),
    PROCESS_ROLE: source.PROCESS_ROLE ?? (local ? "web" : undefined),
    APP_CANONICAL_URL: source.APP_CANONICAL_URL ?? (local ? "http://localhost:3000" : undefined),
    APP_TRUSTED_HOSTS: source.APP_TRUSTED_HOSTS ?? (local ? "localhost,127.0.0.1" : undefined),
    APP_TRUSTED_ORIGINS: source.APP_TRUSTED_ORIGINS ?? (local ? "http://localhost:3000,http://127.0.0.1:3000" : undefined),
    APP_TIME_ZONE: source.APP_TIME_ZONE ?? (local ? "America/Sao_Paulo" : undefined),
    DIRECT_URL: source.DIRECT_URL ?? (local ? databaseUrl : undefined),
    DATABASE_EXPECTED_HOST: source.DATABASE_EXPECTED_HOST ?? (local ? "localhost" : undefined),
    DATABASE_EXPECTED_DIRECT_HOST: source.DATABASE_EXPECTED_DIRECT_HOST ?? (local ? "localhost" : undefined),
    DATABASE_EXPECTED_NAME: source.DATABASE_EXPECTED_NAME ?? (local ? "politizai_crm" : undefined),
    DATABASE_EXPECTED_SCHEMA: source.DATABASE_EXPECTED_SCHEMA ?? (local ? "public" : undefined),
    SESSION_COOKIE_SECURE: source.SESSION_COOKIE_SECURE ?? (local ? "false" : undefined),
    SESSION_COOKIE_HTTP_ONLY: source.SESSION_COOKIE_HTTP_ONLY ?? (local ? "true" : undefined),
    SESSION_COOKIE_SAME_SITE: source.SESSION_COOKIE_SAME_SITE ?? (local ? "lax" : undefined),
    LOG_FORMAT: source.LOG_FORMAT ?? (local ? "pretty" : undefined),
    AUTOMATION_WORKER_ENABLED: source.AUTOMATION_WORKER_ENABLED ?? (local ? "false" : undefined),
    EXTERNAL_ADAPTERS_MODE: source.EXTERNAL_ADAPTERS_MODE ?? (local ? "disabled" : undefined),
    DEMO_SEED_ENABLED: source.DEMO_SEED_ENABLED ?? (local ? "true" : undefined),
    DEMO_CREDENTIALS_ENABLED: source.DEMO_CREDENTIALS_ENABLED ?? (local ? "true" : undefined),
    DEMO_DATA_MODE: source.DEMO_DATA_MODE ?? (local ? "local" : undefined),
    ADMIN_BOOTSTRAP_ENABLED: source.ADMIN_BOOTSTRAP_ENABLED ?? (local ? "false" : undefined),
  };
}

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

function databaseSchema(url: URL): string {
  return url.searchParams.get("schema") ?? "public";
}

function hasRequiredTls(url: URL): boolean {
  return ["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "");
}

export function loadEnvironmentContract(
  source: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): EnvironmentContract {
  const normalized = withSafeLocalDefaults(source);
  const parsed = environmentSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new ConfigurationError(Array.from(new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment")))));
  }

  const values = parsed.data;
  const remote = values.APP_ENV === "staging" || values.APP_ENV === "production";
  const canonicalUrl = new URL(values.APP_CANONICAL_URL);
  const databaseUrl = parsePostgresUrl(values.DATABASE_URL, "DATABASE_URL");
  const directUrl = values.DIRECT_URL ? parsePostgresUrl(values.DIRECT_URL, "DIRECT_URL") : null;
  const trustedHosts = splitList(values.APP_TRUSTED_HOSTS);
  const trustedOrigins = splitList(values.APP_TRUSTED_ORIGINS);
  const invalidVariables = new Set<string>();

  if (remote) {
    if (values.NODE_ENV !== "production") invalidVariables.add("NODE_ENV");
    if (canonicalUrl.protocol !== "https:") invalidVariables.add("APP_CANONICAL_URL");
    if (values.SESSION_COOKIE_SECURE !== "true") invalidVariables.add("SESSION_COOKIE_SECURE");
    if (values.LOG_FORMAT !== "json") invalidVariables.add("LOG_FORMAT");
    if (trustedHosts.length === 0 || trustedHosts.some((host) => host === "*" || host.includes("/"))) invalidVariables.add("APP_TRUSTED_HOSTS");
    if (trustedOrigins.length === 0 || trustedOrigins.some((origin) => {
      try { return new URL(origin).protocol !== "https:"; } catch { return true; }
    })) invalidVariables.add("APP_TRUSTED_ORIGINS");
    if (!trustedHosts.includes(canonicalUrl.host)) invalidVariables.add("APP_TRUSTED_HOSTS");
    if (!trustedOrigins.includes(canonicalUrl.origin)) invalidVariables.add("APP_TRUSTED_ORIGINS");
    if (databaseUrl.hostname !== values.DATABASE_EXPECTED_HOST) invalidVariables.add("DATABASE_EXPECTED_HOST");
    if (databaseName(databaseUrl) !== values.DATABASE_EXPECTED_NAME) invalidVariables.add("DATABASE_EXPECTED_NAME");
    if (databaseSchema(databaseUrl) !== values.DATABASE_EXPECTED_SCHEMA) invalidVariables.add("DATABASE_EXPECTED_SCHEMA");
    if (!hasRequiredTls(databaseUrl)) invalidVariables.add("DATABASE_URL");
    if (values.PROCESS_ROLE === "migration") {
      if (!directUrl) invalidVariables.add("DIRECT_URL");
      if (!values.DATABASE_EXPECTED_DIRECT_HOST || directUrl?.hostname !== values.DATABASE_EXPECTED_DIRECT_HOST) invalidVariables.add("DATABASE_EXPECTED_DIRECT_HOST");
      if (directUrl && databaseName(directUrl) !== values.DATABASE_EXPECTED_NAME) invalidVariables.add("DATABASE_EXPECTED_NAME");
      if (directUrl && databaseSchema(directUrl) !== values.DATABASE_EXPECTED_SCHEMA) invalidVariables.add("DATABASE_EXPECTED_SCHEMA");
      if (directUrl && !hasRequiredTls(directUrl)) invalidVariables.add("DIRECT_URL");
      if (values.DATABASE_URL === values.DIRECT_URL) invalidVariables.add("DIRECT_URL");
    } else if (values.DIRECT_URL) {
      invalidVariables.add("DIRECT_URL");
    }
    if (values.DEMO_SEED_ENABLED !== "false") invalidVariables.add("DEMO_SEED_ENABLED");
    if (values.DEMO_CREDENTIALS_ENABLED !== "false") invalidVariables.add("DEMO_CREDENTIALS_ENABLED");
    if (values.DEMO_DATA_MODE !== "disabled") invalidVariables.add("DEMO_DATA_MODE");
    if (values.EXTERNAL_ADAPTERS_MODE !== "disabled") invalidVariables.add("EXTERNAL_ADAPTERS_MODE");
  } else {
    if (!LOOPBACK_HOSTS.has(databaseUrl.hostname)) invalidVariables.add("DATABASE_URL");
    if (directUrl && !LOOPBACK_HOSTS.has(directUrl.hostname)) invalidVariables.add("DIRECT_URL");
    if (source.ALLOW_REMOTE_DATABASE === "1") invalidVariables.add("ALLOW_REMOTE_DATABASE");
  }

  for (const [name, value] of Object.entries(source)) {
    if (name.startsWith("NEXT_PUBLIC_") && SECRET_PUBLIC_NAME.test(name) && value?.trim()) invalidVariables.add(name);
    if (remote && /(PROVIDER|ADAPTER)_MODE$/i.test(name) && value && !DISABLED_ADAPTER_MODES.has(value.toLowerCase())) invalidVariables.add(name);
    if (remote && EXTERNAL_CREDENTIAL_NAMES.has(name) && value?.trim()) invalidVariables.add(name);
  }
  if (values.PROCESS_ROLE === "worker" && values.AUTOMATION_WORKER_ENABLED !== "true") invalidVariables.add("AUTOMATION_WORKER_ENABLED");
  if (values.PROCESS_ROLE !== "bootstrap" && values.ADMIN_BOOTSTRAP_ENABLED === "true") invalidVariables.add("ADMIN_BOOTSTRAP_ENABLED");

  if (invalidVariables.size > 0) throw new ConfigurationError([...invalidVariables].sort());

  return Object.freeze({
    ...values,
    canonicalUrl,
    databaseUrl,
    directUrl,
    trustedHosts,
    trustedOrigins,
    isRemote: remote,
  });
}
