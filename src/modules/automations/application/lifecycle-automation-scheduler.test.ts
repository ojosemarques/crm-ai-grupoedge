import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createLifecycleAutomationScanner } from "@/modules/automations/application/lifecycle-automation-scheduler";

describe("varredura de automações de ciclo de vida", () => {
  it("não carrega leads quando não existem regras ativas de ciclo de vida", async () => {
    const database = {
      workspace: {
        findMany: vi.fn().mockResolvedValue([{
          id: "workspace-1",
          commercialSettings: [{ revision: 7, leadStagnationDays: 5 }],
        }]),
      },
      automationRule: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany: vi.fn() },
      automationRun: { findMany: vi.fn() },
    } as unknown as PrismaClient;
    const publish = vi.fn();
    const scanner = createLifecycleAutomationScanner({
      database,
      publish,
      now: () => new Date("2026-11-24T12:00:00.000Z"),
    });

    await expect(scanner.scanDue()).resolves.toEqual({ workspaces: 1, published: 0 });
    expect(database.lead.findMany).not.toHaveBeenCalled();
    expect(database.automationRun.findMany).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("não republica eventos que já possuem execução idempotente", async () => {
    const updatedAt = new Date("2026-11-24T12:00:00.000Z");
    const stagnantKey = "lead-stagnant:lead-1:history-1:settings-7";
    const nextActionKey = `lead-without-next-action:lead-2:${updatedAt.toISOString()}`;
    const stagnantRunKey = `${stagnantKey}:rule:rule-stagnant`;
    const nextActionRunKey = `${nextActionKey}:rule:rule-next-action`;
    const database = {
      workspace: {
        findMany: vi.fn().mockResolvedValue([{
          id: "workspace-1",
          commercialSettings: [{ revision: 7, leadStagnationDays: 5 }],
        }]),
      },
      lead: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{
            id: "lead-1",
            stageHistory: [{ id: "history-1", enteredAt: new Date("2026-11-01T12:00:00.000Z") }],
          }])
          .mockResolvedValueOnce([{ id: "lead-2", updatedAt }]),
      },
      automationRule: {
        findMany: vi.fn().mockResolvedValue([
          { id: "rule-stagnant", triggerType: "LEAD_STAGNANT", conditions: { all: [] } },
          { id: "rule-next-action", triggerType: "LEAD_WITHOUT_NEXT_ACTION", conditions: { all: [] } },
        ]),
      },
      automationRun: {
        findMany: vi.fn().mockResolvedValue([
          { idempotencyKey: stagnantRunKey },
          { idempotencyKey: nextActionRunKey },
        ]),
      },
    } as unknown as PrismaClient;
    const publish = vi.fn();
    const scanner = createLifecycleAutomationScanner({
      database,
      publish,
      now: () => new Date("2026-11-24T12:00:00.000Z"),
    });

    await expect(scanner.scanDue()).resolves.toEqual({ workspaces: 1, published: 0 });
    expect(publish).not.toHaveBeenCalled();
    expect(database.automationRun.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace-1", idempotencyKey: { in: [stagnantRunKey, nextActionRunKey] } },
      select: { idempotencyKey: true },
    });
  });

  it("publica somente os eventos ainda ausentes", async () => {
    const updatedAt = new Date("2026-11-24T12:00:00.000Z");
    const database = {
      workspace: {
        findMany: vi.fn().mockResolvedValue([{
          id: "workspace-1",
          commercialSettings: [{ revision: 7, leadStagnationDays: 5 }],
        }]),
      },
      lead: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{
            id: "lead-1",
            stageHistory: [{ id: "history-1", enteredAt: new Date("2026-11-01T12:00:00.000Z") }],
          }])
          .mockResolvedValueOnce([{ id: "lead-2", updatedAt }]),
      },
      automationRule: {
        findMany: vi.fn().mockResolvedValue([
          { id: "rule-stagnant", triggerType: "LEAD_STAGNANT", conditions: { all: [] } },
          { id: "rule-next-action", triggerType: "LEAD_WITHOUT_NEXT_ACTION", conditions: { all: [] } },
        ]),
      },
      automationRun: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const publish = vi.fn().mockResolvedValue({ scheduled: [{ duplicated: false }] });
    const scanner = createLifecycleAutomationScanner({
      database,
      publish,
      now: () => new Date("2026-11-24T12:00:00.000Z"),
    });

    await expect(scanner.scanDue()).resolves.toEqual({ workspaces: 1, published: 2 });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.map(([event]) => event.triggerType)).toEqual([
      "LEAD_STAGNANT",
      "LEAD_WITHOUT_NEXT_ACTION",
    ]);
  });
});
