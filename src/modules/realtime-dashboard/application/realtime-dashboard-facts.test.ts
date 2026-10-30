import { expect, it, vi } from "vitest";
import { readRealtimeDashboardFacts } from "./realtime-dashboard-facts";

it("exclui originais substituídos sem limitar a data da correção e preserva a frente de estornos", async () => {
  const from = new Date("2026-10-26T03:00:00Z"), to = new Date("2026-10-29T03:00:00Z");
  const original = { id: "original", eventType: "TASK_COMPLETED", pipelineId: "pros", safeMetadata: null, correctionSource: null, quantity: 1 };
  const replacement = { ...original, id: "replacement", pipelineId: null, safeMetadata: { _commercialFrontPipelineId: "ads" } };
  const reversal = { ...original, id: "reversal", pipelineId: null, quantity: -1, correctionSource: { pipelineId: "pros", safeMetadata: null } };
  const findMany = vi.fn().mockResolvedValueOnce([original, replacement, reversal]).mockResolvedValueOnce([{ correctionOfFactId: "original" }]);
  const database = { auditLog: { findMany: vi.fn().mockResolvedValue([]) }, commercialMetricFact: { findMany }, pipeline: { findMany: vi.fn().mockResolvedValue([{ id: "pros", name: "Prospecção Ativa" }, { id: "ads", name: "Anúncios" }]) } };
  const scope = { where: { creditedMemberId: "member" }, leadWhere: { ownerMemberId: "member" }, memberIds: ["member"] };
  const result = await readRealtimeDashboardFacts(database as never, "workspace", from, to, "PROSPECTING", scope);
  expect(result.factRows).toEqual([reversal]);
  expect(result.unclassified).toBe(0);
  expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ workspaceId: "workspace", occurredAt: { gte: from, lt: to }, AND: [scope.where, { NOT: { eventKey: { endsWith: ":front-classification:reversal:v1" } } }, { NOT: { eventKey: { endsWith: ":test-removal:reversal:v1" } } }] }) }));
  expect(findMany).toHaveBeenNthCalledWith(2, { where: { workspaceId: "workspace", correctionOfFactId: { in: ["original", "replacement", "reversal"] }, OR: [
    { eventKey: { endsWith: ":front-classification:replacement:v1" } },
    { eventKey: { endsWith: ":test-removal:reversal:v1" } },
  ] }, select: { correctionOfFactId: true } });
});

it("não consulta substituições quando o período não contém fatos", async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const database = { auditLog: { findMany: vi.fn().mockResolvedValue([]) }, commercialMetricFact: { findMany }, pipeline: { findMany: vi.fn().mockResolvedValue([]) } };
  expect(await readRealtimeDashboardFacts(database as never, "workspace", new Date(), new Date(), "PROSPECTING")).toEqual({ factRows: [], unclassified: 0 });
  expect(findMany).toHaveBeenCalledTimes(1);
});
