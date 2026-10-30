import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type CommercialMetricEventType } from "@/generated/prisma/client";
import { createRealtimeDashboardService, realtimeTokenHash } from "@/modules/realtime-dashboard/application/realtime-dashboard-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 4 }) });
afterAll(() => database.$disconnect());

describe("separação das frentes no tempo real", () => {
  it("isola tarefas, atividades, vendas, correções e tenants na API privada e pública", async () => {
    const workspace = await database.workspace.create({ data: { slug: `realtime-fronts-${randomUUID()}`, name: "Frentes", timeZone: "America/Sao_Paulo" } });
    const actor = await database.actor.create({ data: { workspaceId: workspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" } });
    const audit = { workspaceId: workspace.id, createdByActorId: actor.id, updatedByActorId: actor.id };
    const [ads, pros, opportunities] = await Promise.all([
      database.pipeline.create({ data: { ...audit, name: "Anúncios", entityType: "LEAD" } }),
      database.pipeline.create({ data: { ...audit, name: "Prospecção Ativa", entityType: "LEAD" } }),
      database.pipeline.create({ data: { ...audit, name: "Vendas", entityType: "OPPORTUNITY" } }),
    ]);
    const user = await database.user.upsert({ where: { normalizedEmail: "carloshenrique@politizai.com" }, update: {}, create: { email: "carloshenrique@politizai.com", normalizedEmail: "carloshenrique@politizai.com", displayName: "Vendedor" } });
    const role = await database.role.create({ data: { ...audit, key: "closer", name: "Closer" } });
    const member = await database.workspaceMember.create({ data: { ...audit, userId: user.id, roleId: role.id, status: "ACTIVE" } });
    const leadId = randomUUID();
    const occurredAt = new Date("2026-10-22T14:00:00Z");
    const fact = (eventType: CommercialMetricEventType, quantity: number, pipelineId: string | null, frontId?: string, dimensions: { creditedMemberId?: string; meetingOwnerMemberIdAtEvent?: string; leadId?: string; occurredAt?: Date } = {}) => database.commercialMetricFact.create({ data: {
      workspaceId: workspace.id, leadId, eventKey: randomUUID(), eventType, occurredAt, sourceEntityType: "Task", sourceEntityId: randomUUID(), creditedMemberId: member.id,
      pipelineId, quantity, valueCents: eventType === "SALE_WON" ? BigInt(quantity * 10000) : null,
      inputFingerprint: "fixture", ...dimensions, ...(frontId ? { safeMetadata: { _commercialFrontPipelineId: frontId } } : {}),
    } });
    await fact("LEAD_CREATED", 1, ads.id);
    for (const eventType of ["TASK_COMPLETED", "CALL_ATTEMPTED", "WHATSAPP_MESSAGE_SENT", "MEETING_SCHEDULED", "MEETING_COMPLETED", "SALE_WON"] as const) {
      await fact(eventType, 2, opportunities.id, ads.id);
      await fact(eventType, 3, pros.id);
    }
    await fact("TASK_COMPLETED", 5, pros.id, ads.id);
    await fact("TASK_COMPLETED", 99, null);
    const original = await fact("TASK_COMPLETED", 1, null);
    for (const kind of ["reversal", "replacement"] as const) {
      const data = { ...original, id: randomUUID() };
      await database.commercialMetricFact.create({ data: { ...data, safeMetadata: kind === "replacement" ? { _commercialFrontPipelineId: ads.id } : {}, eventKey: `${original.eventKey}:front-classification:${kind}:v1`, correctionOfFactId: original.id, reversalReason: "Classificação histórica de teste", quantity: kind === "reversal" ? -1 : 1 } });
    }
    const correctedTask = await fact("TASK_COMPLETED", 2, null, ads.id);
    await database.commercialMetricFact.create({ data: { ...correctedTask, id: randomUUID(), eventKey: randomUUID(), safeMetadata: {}, correctionOfFactId: correctedTask.id, reversalReason: "Resultado corrigido", quantity: -1 } });
    const other = await database.workspace.create({ data: { slug: `realtime-other-${randomUUID()}`, name: "Outro" } });
    await database.commercialMetricFact.create({ data: { workspaceId: other.id, eventKey: randomUUID(), eventType: "SALE_WON", occurredAt, sourceEntityType: "Fixture", sourceEntityId: randomUUID(), quantity: 999, inputFingerprint: "fixture", safeMetadata: { _commercialFrontPipelineId: ads.id } } });
    const token = randomBytes(32).toString("base64url");
    await database.realtimeDashboardShare.create({ data: { workspaceId: workspace.id, tokenHash: realtimeTokenHash(token), createdByActorId: actor.id, updatedByActorId: actor.id } });
    const service = createRealtimeDashboardService({ database, authorization: { assertAuthorized: vi.fn(), authorize: vi.fn().mockResolvedValue({ allowed: true }) }, now: () => new Date("2026-10-22T15:00:00Z"), publicWorkspaceSlug: workspace.slug });
    const prospecting = await service.publicSnapshot(token);
    const advertising = await service.publicSnapshot(token, "ADVERTISING");
    expect(prospecting.today.totals).toMatchObject({ tasksCompleted: 3, calls: 3, messages: 3, meetingsScheduled: 1, meetingsCompleted: 3, sales: 3, salesValueCents: "30000" });
    expect(advertising.today.totals).toMatchObject({ tasksCompleted: 9, calls: 2, messages: 2, meetingsScheduled: 1, meetingsCompleted: 2, sales: 2, salesValueCents: "20000" });
    expect(prospecting.week.ranking[0]).toMatchObject({ tasksCompleted: 3, sales: 3 });
    expect(advertising.week.ranking[0]).toMatchObject({ tasksCompleted: 9, sales: 2 });
    expect((await service.screen({ workspaceId: workspace.id } as never, "ADVERTISING")).snapshot).toEqual(advertising);
    expect(await service.publicTvSnapshot("ADVERTISING")).toEqual(advertising);
    expect(advertising.quality.reason).toContain("1 fatos sem frente comercial identificada");
    const closer = async (email: string, name: string) => {
      const user = await database.user.upsert({ where: { normalizedEmail: email }, update: {}, create: { email, normalizedEmail: email, displayName: name } });
      return { ...await database.workspaceMember.create({ data: { ...audit, userId: user.id, roleId: role.id, status: "ACTIVE" } }), name: user.displayName };
    };
    const jhon = await closer("jhoncunha@politizai.com", "Jhon");
    const ede = await closer("ederafael@politizai.com", "Ede");
    for (const [memberId, assigned, completed] of [[jhon.id, 5, 3], [ede.id, 3, 1]] as const) {
      for (let index = 0; index < assigned; index += 1) await fact("MEETING_SCHEDULED", 1, ads.id, undefined, { meetingOwnerMemberIdAtEvent: memberId, leadId: randomUUID() });
      await fact("MEETING_COMPLETED", completed, ads.id, undefined, { creditedMemberId: memberId });
    }
    const dynamic = await service.publicSnapshot(token, "ADVERTISING");
    expect(dynamic.today.leadsReceived).toBe(1);
    expect(dynamic.today.goals.meetingsScheduled.targetValue).toBe("1");
    expect(dynamic.week.ranking.find(row => row.name === jhon.name)!.goals.today.meetingsCompleted).toMatchObject({ actualValue: "3", targetValue: "3" });
    expect(dynamic.week.ranking.find(row => row.name === ede.name)!.goals.today.meetingsCompleted).toMatchObject({ actualValue: "1", targetValue: "2" });
    const scopedService = createRealtimeDashboardService({ database, authorization: { assertAuthorized: vi.fn(), authorize: vi.fn().mockResolvedValue({ allowed: true, scope: "WORKSPACE" }) }, now: () => new Date("2026-10-22T15:00:00Z") });
    expect(await scopedService.advertisingSnapshot({ workspaceId: workspace.id, memberId: member.id } as never)).toEqual(dynamic);
    const ownService = createRealtimeDashboardService({ database, authorization: { assertAuthorized: vi.fn(), authorize: vi.fn().mockResolvedValue({ allowed: true, scope: "OWN" }) }, now: () => new Date("2026-10-22T15:00:00Z") });
    const own = await ownService.advertisingSnapshot({ workspaceId: workspace.id, memberId: member.id } as never);
    expect(own.week.ranking.map(row => row.name)).toEqual(["Vendedor"]);
    expect(own.today.totals.meetingsCompleted).toBe(2);
    const denied = createRealtimeDashboardService({ database, authorization: { assertAuthorized: vi.fn().mockRejectedValue(new Error("Acesso negado")), authorize: vi.fn().mockResolvedValue({ allowed: false, scope: null }) }, now: () => new Date("2026-10-22T15:00:00Z") });
    await expect(denied.advertisingSnapshot({ workspaceId: workspace.id, memberId: member.id } as never)).rejects.toThrow("Acesso negado");
    const pastLead = randomUUID();
    await fact("MEETING_SCHEDULED", 1, ads.id, undefined, { leadId: pastLead, occurredAt: new Date("2026-10-21T03:00:00Z") });
    await fact("MEETING_SCHEDULED", 1, ads.id, undefined, { leadId: pastLead });
    await fact("MEETING_SCHEDULED", 1, ads.id, undefined, { leadId: randomUUID(), occurredAt: new Date("2026-10-17T12:00:00Z") });
    const yesterdayQuery = { periodPreset: "YESTERDAY" };
    const yesterday = (await service.screen({ workspaceId: workspace.id } as never, "ADVERTISING", yesterdayQuery)).snapshot;
    expect(yesterday.today.totals.meetingsScheduled).toBe(1);
    expect(yesterday.week.totals.meetingsScheduled).toBe(1);
    expect(yesterday.selection).toEqual({ preset: "YESTERDAY", label: "Ontem" });
    expect(yesterday.today.goals.meetingsScheduled.targetValue).toBeNull();
    expect(yesterday.week.daily).toHaveLength(1);
    expect((await service.publicTvSnapshot("ADVERTISING")).selection).toBeUndefined();
    expect((await service.publicSnapshot(token, "ADVERTISING")).selection).toBeUndefined();
    expect((await service.screen({ workspaceId: workspace.id } as never, "ADVERTISING", yesterdayQuery)).snapshot).toEqual(yesterday);
    expect((await service.screen({ workspaceId: workspace.id } as never, "ADVERTISING", { periodPreset: "LAST_WEEK" })).snapshot.today.totals.meetingsScheduled).toBe(1);
    expect((await service.screen({ workspaceId: workspace.id } as never, "ADVERTISING", { periodPreset: "THIS_WEEK" })).snapshot.today.totals.meetingsScheduled).toBe(10);
    expect((await service.screen({ workspaceId: workspace.id } as never, "ADVERTISING", { periodPreset: "CUSTOM", periodFrom: "2026-10-21", periodTo: "2026-10-21" })).snapshot.today.totals.meetingsScheduled).toBe(1);
    await expect(service.screen({ workspaceId: workspace.id } as never, "ADVERTISING", { periodPreset: "CUSTOM", periodFrom: "2026-10-22", periodTo: "2026-10-21" })).rejects.toThrow();
    await database.pipeline.update({ where: { id: ads.id }, data: { deletedAt: occurredAt } });
    expect((await service.publicSnapshot(token, "ADVERTISING")).today.totals).toMatchObject({ tasksCompleted: 0, sales: 0 });
    expect((await service.publicSnapshot(token)).today.totals).toEqual(prospecting.today.totals);
  });
});
