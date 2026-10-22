import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createSalesGateService } from "@/modules/opportunities/application/sales-gate-service";
import { readCrmMcpAudit } from "./crm-mcp-audit";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";

const mocks = vi.hoisted(() => ({ assert: vi.fn(), auditCount: vi.fn(), auditRows: vi.fn(), violationCount: vi.fn(), violationRows: vi.fn() }));
vi.mock("@/modules/users/permissions/authorization-service", () => ({ getAuthorizationService: () => ({ assertAuthorized: mocks.assert }) }));
vi.mock("@/shared/core/database/client", () => ({ getDatabaseClient: () => ({ auditLog: { count: mocks.auditCount, findMany: mocks.auditRows }, processViolation: { count: mocks.violationCount, findMany: mocks.violationRows } }) }));
const context = { workspaceId: "11111111-1111-4111-8111-111111111111", memberId: "22222222-2222-4222-8222-222222222222" } as AuthenticatedContext;

describe("bounded machine reads", () => {
  it("reads audit events and stored findings in bounded pages without a live scan transaction", async () => {
    mocks.assert.mockResolvedValue(undefined); mocks.auditCount.mockResolvedValue(100); mocks.violationCount.mockResolvedValue(0); mocks.violationRows.mockResolvedValue([]);
    mocks.auditRows.mockResolvedValue([{ id: "event", reason: "teste", changes: { secret: "hidden", phone: "11999999999" }, metadata: { token: "hidden" } }]);
    const result = await readCrmMcpAudit(context, { auditPage: 2 });
    expect(mocks.assert).toHaveBeenCalledWith(context, "audit.read", expect.objectContaining({ workspaceId: context.workspaceId }));
    expect(mocks.auditRows).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: context.workspaceId }, take: 25, skip: 25 }));
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(JSON.stringify(result)).not.toContain("11999999999");
    expect(result.audit.total).toBe(100);
  });
  it("denies unauthorized audit reads before querying", async () => {
    mocks.auditRows.mockClear(); mocks.assert.mockRejectedValueOnce(new Error("denied"));
    await expect(readCrmMcpAudit(context, {})).rejects.toThrow("denied");
    expect(mocks.auditRows).not.toHaveBeenCalled();
  });
  it("bounds both task and meeting sources while retaining canonical visibility filters", async () => {
    const tasks = vi.fn().mockResolvedValue([]); const meetings = vi.fn().mockResolvedValue([]);
    const database = { teamMember: { findMany: vi.fn().mockResolvedValue([]) }, task: { findMany: tasks }, meeting: { findMany: meetings }, pipelineOriginAccessRule: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaClient;
    const authorization = { authorize: vi.fn().mockResolvedValue({ allowed: true as const, scope: "WORKSPACE" as const }), assertAuthorized: vi.fn() };
    const service = createSalesGateService({ database, authorization, now: () => new Date("2026-10-22T00:00:00Z") });
    const result = await service.getActivityQueue(context, { page: 2, pageSize: 10 });
    expect(tasks).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 11, where: expect.objectContaining({ workspaceId: context.workspaceId }) }));
    expect(meetings).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 11, where: expect.objectContaining({ workspaceId: context.workspaceId }) }));
    expect(result.pagination).toMatchObject({ hasMore: false, countsScope: "PAGE" });
  });
  it("does not expose other owners and lets the caller continue past empty source pages", async () => {
    const hiddenTask = { context: "PRE_SALE", meetingId: null, opportunityId: null, assigneeMemberId: "other-member", queue: null };
    const database = { teamMember: { findMany: vi.fn().mockResolvedValue([]) }, task: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 11 }, () => hiddenTask)) }, meeting: { findMany: vi.fn().mockResolvedValue([]) }, pipelineOriginAccessRule: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaClient;
    const authorization = { authorize: vi.fn().mockResolvedValue({ allowed: true as const, scope: "OWN" as const }), assertAuthorized: vi.fn() };
    const service = createSalesGateService({ database, authorization, now: () => new Date("2026-10-22T00:00:00Z") });
    const result = await service.getActivityQueue(context, { page: 1, pageSize: 10 });
    expect(result.items).toEqual([]);
    expect(result.pagination?.hasMore).toBe(true);
  });
});
