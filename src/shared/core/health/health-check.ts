import { checkDatabaseConnection } from "@/shared/core/database/health";
import { logger } from "@/shared/core/logging/logger";

type DependencyStatus = "ok" | "error";

export type LivenessReport = Readonly<{
  service: "politizai-crm";
  status: "ok";
  timestamp: string;
}>;

export type ReadinessReport = Readonly<{
  service: "politizai-crm";
  ready: boolean;
  timestamp: string;
  checks: { database: DependencyStatus };
}>;

type ReadinessDatabaseError = Readonly<{
  errorName: string;
  errorCode: string | null;
  errorMessage: string;
}>;

function describeDatabaseError(error: unknown): ReadinessDatabaseError {
  if (!(error instanceof Error)) {
    return { errorName: "UnknownError", errorCode: null, errorMessage: String(error) };
  }

  const code = (error as Error & { code?: unknown }).code;
  return {
    errorName: error.name,
    errorCode: typeof code === "string" || typeof code === "number" ? String(code) : null,
    errorMessage: error.message,
  };
}

function logDatabaseReadinessError(error: ReadinessDatabaseError): void {
  logger.error({ event: "readiness.database.failed", ...error }, "Falha na verificação de prontidão do banco.");
}

export function createLivenessCheck(now: () => Date = () => new Date()) {
  return function livenessCheck(): LivenessReport {
    return { service: "politizai-crm", status: "ok", timestamp: now().toISOString() };
  };
}

export function createReadinessCheck({
  checkDatabase = checkDatabaseConnection,
  logDatabaseError = logDatabaseReadinessError,
  now = () => new Date(),
}: Readonly<{
  checkDatabase?: () => Promise<void>;
  logDatabaseError?: (error: ReadinessDatabaseError) => void;
  now?: () => Date;
}> = {}) {
  return async function readinessCheck(): Promise<ReadinessReport> {
    try {
      await checkDatabase();
      return { service: "politizai-crm", ready: true, timestamp: now().toISOString(), checks: { database: "ok" } };
    } catch (error) {
      logDatabaseError(describeDatabaseError(error));
      return { service: "politizai-crm", ready: false, timestamp: now().toISOString(), checks: { database: "error" } };
    }
  };
}

export const checkLiveness = createLivenessCheck();
export const checkReadiness = createReadinessCheck();
