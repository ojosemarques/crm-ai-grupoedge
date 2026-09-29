import { getDatabaseClient } from "@/shared/core/database/client";

export async function checkDatabaseConnection(): Promise<void> {
  await getDatabaseClient().$queryRaw`SELECT 1`;
}
