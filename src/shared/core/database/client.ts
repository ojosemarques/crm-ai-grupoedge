import { AsyncLocalStorage } from "node:async_hooks";

import { PrismaClient } from "@/generated/prisma/client";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const globalForDatabase = globalThis as typeof globalThis & {
  politizaiDatabaseClient?: PrismaClient;
};

type RequestDatabaseContext = {
  databaseUrl: string;
  client?: PrismaClient;
};

const requestDatabase = new AsyncLocalStorage<RequestDatabaseContext>();

const DATABASE_CONNECTION_TIMEOUT_MS = 10_000;
const DATABASE_POOL_MAX = 5;

function createDatabaseClient(databaseUrl: string, max: number): PrismaClient {
  const adapter = createPostgresAdapter(databaseUrl, {
    connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
    max,
  });
  return new PrismaClient({ adapter });
}

export async function withRequestDatabaseClient<T>(
  databaseUrl: string,
  operation: () => Promise<T>,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<T> {
  const context: RequestDatabaseContext = { databaseUrl };
  return requestDatabase.run(context, async () => {
    try {
      return await operation();
    } finally {
      if (context.client) {
        waitUntil(context.client.$disconnect());
      }
    }
  });
}

export function getDatabaseClient(): PrismaClient {
  const requestContext = requestDatabase.getStore();
  if (requestContext) {
    requestContext.client ??= createDatabaseClient(requestContext.databaseUrl, DATABASE_POOL_MAX);
    return requestContext.client;
  }

  if (globalForDatabase.politizaiDatabaseClient) {
    return globalForDatabase.politizaiDatabaseClient;
  }

  const config = getApplicationConfig();
  const client = createDatabaseClient(config.DATABASE_URL, DATABASE_POOL_MAX);

  // Route handlers and server components share one bounded pool per process in
  // every environment. Without this assignment, `next start` created a new
  // five-connection pool on each service lookup until PostgreSQL timed out.
  globalForDatabase.politizaiDatabaseClient = client;

  return client;
}
