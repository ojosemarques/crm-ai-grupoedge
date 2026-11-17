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

function closeRequestDatabaseClient(
  context: RequestDatabaseContext,
  waitUntil: (promise: Promise<unknown>) => void,
): void {
  if (context.client) {
    waitUntil(context.client.$disconnect());
  }
}

function keepDatabaseUntilResponseEnds<T>(
  result: T,
  onComplete: () => void,
): T {
  if (!(result instanceof Response) || !result.body) {
    return result;
  }

  const reader = result.body.getReader();
  let completed = false;
  const completeOnce = () => {
    if (completed) return;
    completed = true;
    onComplete();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          completeOnce();
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        completeOnce();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        completeOnce();
      }
    },
  });

  return new Response(body, result) as T;
}

export async function withRequestDatabaseClient<T>(
  databaseUrl: string,
  operation: () => Promise<T>,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<T> {
  const context: RequestDatabaseContext = { databaseUrl };
  return requestDatabase.run(context, async () => {
    let databaseLifetimeFollowsResponse = false;
    try {
      const result = await operation();
      if (result instanceof Response && result.body) {
        databaseLifetimeFollowsResponse = true;
        return keepDatabaseUntilResponseEnds(result, () => {
          closeRequestDatabaseClient(context, waitUntil);
        });
      }
      return result;
    } finally {
      if (!databaseLifetimeFollowsResponse) {
        closeRequestDatabaseClient(context, waitUntil);
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
