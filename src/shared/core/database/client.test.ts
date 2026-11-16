import { afterEach, describe, expect, it, vi } from "vitest";

const disconnect = vi.fn().mockResolvedValue(undefined);
const prismaClients: Array<{ $disconnect: typeof disconnect }> = [];

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: vi.fn(function PrismaClient() {
    const client = { $disconnect: disconnect };
    prismaClients.push(client);
    return client;
  }),
}));

vi.mock("@/shared/core/database/postgres-adapter", () => ({
  createPostgresAdapter: vi.fn(() => ({})),
}));

vi.mock("@/shared/core/config/application-config", () => ({
  getApplicationConfig: vi.fn(() => ({
    DATABASE_URL: "postgresql://global.example/crm?schema=crm",
  })),
}));

describe("cliente PostgreSQL por requisição Cloudflare", () => {
  afterEach(() => {
    vi.clearAllMocks();
    prismaClients.length = 0;
  });

  it("reutiliza um único cliente na requisição e agenda o fechamento no contexto", async () => {
    const waitUntil = vi.fn();
    const { getDatabaseClient, withRequestDatabaseClient } = await import("@/shared/core/database/client");

    const result = await withRequestDatabaseClient(
      "postgresql://hyperdrive.local/crm?schema=crm",
      async () => {
        expect(getDatabaseClient()).toBe(getDatabaseClient());
        return "ok";
      },
      waitUntil,
    );

    expect(result).toBe("ok");
    expect(prismaClients).toHaveLength(1);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("agenda o fechamento mesmo quando o handler falha", async () => {
    const waitUntil = vi.fn();
    const { getDatabaseClient, withRequestDatabaseClient } = await import("@/shared/core/database/client");

    await expect(withRequestDatabaseClient(
      "postgresql://hyperdrive.local/crm?schema=crm",
      async () => {
        getDatabaseClient();
        throw new Error("falha sintética");
      },
      waitUntil,
    )).rejects.toThrow("falha sintética");

    expect(disconnect).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });
});
