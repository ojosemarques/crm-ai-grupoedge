import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchHandler = vi.fn();
const withRequestDatabaseClient = vi.fn(
  (_databaseUrl: string, operation: () => Promise<Response>) => operation(),
);
const scheduledFetch = vi.fn();

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: fetchHandler },
}));

vi.mock("@/shared/core/database/client", () => ({
  withRequestDatabaseClient,
}));

describe("Worker Cloudflare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchHandler.mockResolvedValue(new Response(null, { status: 204 }));
    scheduledFetch.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", scheduledFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("executa o cron pelo host canônico aceito pela aplicação", async () => {
    const { default: worker } = await import("../worker/index");
    const pending: Promise<unknown>[] = [];
    const context = {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    };

    worker.scheduled(undefined, {
      CLOUDFLARE_CRON_ENABLED: "true",
      SERVERLESS_WORKER_SECRET: "s".repeat(32),
      HYPERDRIVE: {
        connectionString: "postgresql://hyperdrive.example.test/crm",
      },
    }, context);

    await Promise.all(pending);

    const request = scheduledFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://crm.edgegrupo.com/api/internal/worker/tick");
    expect(request.headers.get("authorization")).toBe(`Bearer ${"s".repeat(32)}`);
    expect(fetchHandler).not.toHaveBeenCalled();
    expect(withRequestDatabaseClient).not.toHaveBeenCalled();
  });
});
