import { describe, expect, it, vi } from "vitest";

import { createLivenessCheck, createReadinessCheck } from "@/shared/core/health/health-check";

describe("health checks PROD-09", () => {
  const now = () => new Date("2026-09-14T20:00:00.000Z");

  it("mantém liveness independente de banco e providers", () => {
    expect(createLivenessCheck(now)()).toEqual({
      service: "politizai-crm",
      status: "ok",
      timestamp: "2026-09-14T20:00:00.000Z",
    });
  });

  it("marca readiness indisponível sem revelar a falha do banco", async () => {
    const checkDatabase = vi.fn().mockRejectedValue(new Error("falha simulada do banco"));
    await expect(createReadinessCheck({ checkDatabase, now })()).resolves.toEqual({
      service: "politizai-crm",
      ready: false,
      timestamp: "2026-09-14T20:00:00.000Z",
      checks: { database: "error" },
    });
    expect(checkDatabase).toHaveBeenCalledOnce();
  });
});
