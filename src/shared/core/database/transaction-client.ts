import type { Prisma, PrismaClient } from "@/generated/prisma/client";

// Domain services keep their validation and writes inside the caller's transaction.
export function transactionDatabase(transaction: Prisma.TransactionClient): PrismaClient {
  return new Proxy(transaction, {
    get(target, property) {
      if (property === "$transaction") return async (operation: (client: Prisma.TransactionClient) => Promise<unknown>) => {
        if (typeof operation !== "function") throw new Error("Expected an interactive transaction callback.");
        return operation(transaction);
      };
      return Reflect.get(target, property);
    },
  }) as PrismaClient;
}
