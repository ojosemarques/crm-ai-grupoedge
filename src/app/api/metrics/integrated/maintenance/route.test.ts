import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiAuthentication = vi.fn();
const backfill = vi.fn();
const reconcile = vi.fn();

vi.mock("@/modules/auth/http/authentication-guards", () => ({ requireApiAuthentication }));
vi.mock("@/modules/metrics/application/commercial-metric-backfill-service", () => ({
  getCommercialMetricBackfillService: () => ({ run: backfill }),
}));
vi.mock("@/modules/metrics/application/commercial-metric-reconciliation-service", () => ({
  getCommercialMetricReconciliationService: () => ({ run: reconcile }),
}));

const url = "https://crm.example/api/metrics/integrated/maintenance";

function request(action: string, origin = "https://crm.example") {
  return new NextRequest(url, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ action }),
  });
}

describe("manutenção de métricas comerciais", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiAuthentication.mockResolvedValue({ roleKey: "administrator", workspaceId: "workspace-a", actorId: "actor-a" });
    backfill.mockResolvedValue({ status: "COMPLETED", eligibleCount: 20, createdCount: 5, existingCount: 15, reviewCount: 0, failedCount: 0 });
    reconcile.mockResolvedValue({ status: "COMPLETED", expectedCount: 20, actualCount: 20, gapCount: 0, divergentCheckCount: 0 });
  });

  it("rejeita outra origem antes de executar", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("APPLY", "https://external.example"));
    expect(response.status).toBe(403);
    expect(backfill).not.toHaveBeenCalled();
  });

  it("rejeita usuário sem papel de administrador", async () => {
    requireApiAuthentication.mockResolvedValueOnce({ roleKey: "commercial_manager" });
    const { POST } = await import("./route");
    const response = await POST(request("APPLY"));
    expect(response.status).toBe(403);
    expect(backfill).not.toHaveBeenCalled();
  });

  it("não mostra a página a quem não está autenticado", async () => {
    const { ApplicationError } = await import("@/shared/core/errors/application-error");
    requireApiAuthentication.mockRejectedValueOnce(new ApplicationError("Sessão ausente.", { code: "SESSION_EXPIRED", statusCode: 401, expose: true }));
    const { GET } = await import("./route");
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(401);
    expect(backfill).not.toHaveBeenCalled();
  });

  it("valida a ação e mantém o workspace no contexto autenticado", async () => {
    const { POST } = await import("./route");
    expect((await POST(request("DELETE"))).status).toBe(400);
    expect(backfill).not.toHaveBeenCalled();
    const response = await POST(request("APPLY"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("criados 5");
    expect(backfill).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-a" }), expect.objectContaining({ mode: "APPLY", batchSize: 100 }));
  });

  it("reconcilia usando a identidade autenticada", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("RECONCILE"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("verificações divergentes 0");
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ actorId: "actor-a" }), expect.objectContaining({ runKey: expect.stringContaining("commercial-metrics:reconcile") }));
  });
});
