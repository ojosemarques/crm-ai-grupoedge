import { checkDatabaseConnection } from "@/shared/core/database/health";

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

export function createLivenessCheck(now: () => Date = () => new Date()) {
  return function livenessCheck(): LivenessReport {
    return { service: "politizai-crm", status: "ok", timestamp: now().toISOString() };
  };
}

export function createReadinessCheck({
  checkDatabase = checkDatabaseConnection,
  now = () => new Date(),
}: Readonly<{ checkDatabase?: () => Promise<void>; now?: () => Date }> = {}) {
  return async function readinessCheck(): Promise<ReadinessReport> {
    try {
      await checkDatabase();
      return { service: "politizai-crm", ready: true, timestamp: now().toISOString(), checks: { database: "ok" } };
    } catch {
      return { service: "politizai-crm", ready: false, timestamp: now().toISOString(), checks: { database: "error" } };
    }
  };
}

export const checkLiveness = createLivenessCheck();
export const checkReadiness = createReadinessCheck();
