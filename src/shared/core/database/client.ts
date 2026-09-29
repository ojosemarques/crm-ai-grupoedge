import { PrismaClient } from "@/generated/prisma/client";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const globalForDatabase = globalThis as typeof globalThis & {
  politizaiDatabaseClient?: PrismaClient;
};

export function getDatabaseClient(): PrismaClient {
  if (globalForDatabase.politizaiDatabaseClient) {
    return globalForDatabase.politizaiDatabaseClient;
  }

  const config = getApplicationConfig();
  const adapter = createPostgresAdapter(config.DATABASE_URL, {
    connectionTimeoutMillis: 2_000,
    max: 5,
  });
  const client = new PrismaClient({ adapter });

  // Route handlers and server components share one bounded pool per process in
  // every environment. Without this assignment, `next start` created a new
  // five-connection pool on each service lookup until PostgreSQL timed out.
  globalForDatabase.politizaiDatabaseClient = client;

  return client;
}
