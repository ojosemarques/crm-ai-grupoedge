import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationError } from "@/shared/core/errors/application-error";

const publicTvSnapshot = vi.fn();
const enforceRateLimit = vi.fn();
vi.mock("@/modules/realtime-dashboard/application/realtime-dashboard-service", () => ({
  getRealtimeDashboardService: () => ({ publicTvSnapshot }),
}));
vi.mock("@/shared/core/http/request-hardening", () => ({
  enforceRateLimit, requestClientKey: () => "client",
}));

describe("API pública da TV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceRateLimit.mockResolvedValue(undefined);
    publicTvSnapshot.mockResolvedValue({ workspaceName: "Empresa", today: {}, week: {} });
  });

  it("consulta apenas o workspace do servidor sem repassar parâmetros do visitante", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://crm.example/api/public/tempo?workspaceId=outro", { headers: { authorization: "Bearer outro" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: { workspaceName: "Empresa", today: {}, week: {} } });
    expect(publicTvSnapshot).toHaveBeenCalledWith();
    expect(enforceRateLimit).toHaveBeenCalledWith("public-realtime-tv", "client", { limit: 120, windowMs: 60_000 });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("nega acesso revogado sem cache ou exposição do motivo interno", async () => {
    publicTvSnapshot.mockRejectedValueOnce(new ApplicationError("Placar indisponível.", { code: "REALTIME_SHARE_NOT_FOUND", statusCode: 404, expose: true }));
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://crm.example/api/public/tempo"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("limita abuso antes de consultar dados", async () => {
    enforceRateLimit.mockRejectedValueOnce(new ApplicationError("Limite excedido.", { code: "RATE_LIMITED", statusCode: 429, expose: true }));
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://crm.example/api/public/tempo"));
    expect(response.status).toBe(429);
    expect(publicTvSnapshot).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
