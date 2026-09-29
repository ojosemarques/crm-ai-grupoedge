import pino from "pino";

import { redactTelemetryValue } from "@/shared/core/security/redaction";

const allowedLogLevels = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

const configuredLevel = process.env.LOG_LEVEL ?? "info";
const level = allowedLogLevels.has(configuredLevel) ? configuredLevel : "info";

export const logger = pino({
  base: {
    appEnvironment: process.env.APP_ENV ?? "local",
    commitId: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? process.env.GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.DEPLOYMENT_ID ?? "local",
    processRole: process.env.PROCESS_ROLE ?? "web",
    service: process.env.APP_NAME ?? "politizai-crm",
  },
  level,
  formatters: {
    log(object) {
      return redactTelemetryValue(object) as Record<string, unknown>;
    },
  },
  redact: {
    paths: [
      "DATABASE_URL",
      "DIRECT_URL",
      "databaseUrl",
      "password",
      "*.password",
      "*.*.password",
      "authorization",
      "cookie",
      "token",
      "sessionToken",
      "apiKey",
      "ADMIN_BOOTSTRAP_SECRET",
      "ADMIN_BOOTSTRAP_PASSWORD",
      "*.token",
      "*.sessionToken",
      "*.apiKey",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REMOVIDO]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
