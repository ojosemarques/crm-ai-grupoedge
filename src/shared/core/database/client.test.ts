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
    DATABASE_URL: "postgresql://global.example.test/crm?schema=crm",
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
    const { createPostgresAdapter } = await import("@/shared/core/database/postgres-adapter");

    const result = await withRequestDatabaseClient(
      "postgresql://hyperdrive.example.test/crm?schema=crm",
      async () => {
        expect(getDatabaseClient()).toBe(getDatabaseClient());
        return "ok";
      },
      waitUntil,
    );

    expect(result).toBe("ok");
    expect(prismaClients).toHaveLength(1);
    expect(createPostgresAdapter).toHaveBeenCalledWith(
      "postgresql://hyperdrive.example.test/crm?schema=crm",
      { connectionTimeoutMillis: 10_000, max: 5 },
    );
    expect(disconnect).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("agenda o fechamento mesmo quando o handler falha", async () => {
    const waitUntil = vi.fn();
    const { getDatabaseClient, withRequestDatabaseClient } = await import("@/shared/core/database/client");

    await expect(withRequestDatabaseClient(
      "postgresql://hyperdrive.example.test/crm?schema=crm",
      async () => {
        getDatabaseClient();
        throw new Error("falha sintética");
      },
      waitUntil,
    )).rejects.toThrow("falha sintética");

    expect(disconnect).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("mantém o cliente aberto até o stream da resposta terminar", async () => {
    const waitUntil = vi.fn();
    const { getDatabaseClient, withRequestDatabaseClient } = await import("@/shared/core/database/client");
    const encoder = new TextEncoder();

    const response = await withRequestDatabaseClient(
      "postgresql://hyperdrive.example.test/crm?schema=crm",
      async () => new Response(new ReadableStream({
        pull(controller) {
          getDatabaseClient();
          controller.enqueue(encoder.encode("ok"));
          controller.close();
        },
      })),
      waitUntil,
    );

    expect(disconnect).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe("ok");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });
});
