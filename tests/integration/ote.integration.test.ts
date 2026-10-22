import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOteService } from "@/modules/ote/application/ote-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_integration_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2026-10-22T15:00:00Z");
const service = createOteService({ database, authorization, now: () => now });
let workspaceId: string;
let admin: AuthenticatedContext, jhon: AuthenticatedContext, ede: AuthenticatedContext, sdr: AuthenticatedContext;

async function context(email: string): Promise<AuthenticatedContext> {
  const m = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: m.userId, type: "HUMAN" } });
  return { workspaceId, workspaceSlug: "politizai", sessionId: randomUUID(), userId: m.userId, memberId: m.id, actorId: actor.id, roleId: m.roleId, roleKey: m.role.key, roleName: m.role.name, displayName: m.user.displayName };
}
const planInput = (memberId: string, values = {}) => ({ action: "SAVE_PLAN", memberId, effectiveMonth: "2026-10", label: "Closer Sênior", role: "CLOSER", fixedCents: "370000", quotaCents: "6000000", bonusCents: "120000", meetingQuota: 20, salesQuota: 4, expectedRevision: 0, ...values });
beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" })).workspaceId;
  [admin, jhon, ede, sdr] = await Promise.all([context("admin@demo.politizai.local"), context("closer1@demo.politizai.local"), context("closer2@demo.politizai.local"), context("sdr1@demo.politizai.local")]);
  await service.command(admin, planInput(jhon.memberId));
  await service.command(admin, planInput(ede.memberId, { label: "Closer Júnior", fixedCents: "250000", quotaCents: "3500000", bonusCents: "70000" }));
  await service.command(admin, planInput(sdr.memberId, { label: "SDR", role: "SDR", fixedCents: "200000", quotaCents: "0", bonusCents: "0" }));
});
afterAll(async () => database.$disconnect());

async function createSale(ownerMemberId: string, closedAt = "2026-10-01T12:00:00Z") {
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
  const intake = await createLeadIntakeService({ database, authorization, now: () => now }).intake({ channel: "MANUAL", idempotencyKey: `ote-test:${randomUUID()}`, fullName: "Cliente OTE sintético", phone: `+55119${Math.floor(Math.random() * 90000000 + 10000000)}`, sourceKey: "manual", priorityBandCode: "P1", interestSummary: "Teste de remuneração", rawPayload: { test: true } }, { workspaceId, actorId: actor.id, actorKey: actor.key, actorType: "SYSTEM" });
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "WON", deletedAt: null } });
  const product = await database.product.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } });
  return database.opportunity.create({ data: { workspaceId, leadId: intake.leadId, ownerMemberId, productId: product.id, pipelineId: stage.pipelineId, currentStageId: stage.id, name: `Venda OTE ${randomUUID()}`, status: "WON", amountCents: 6000000n, mrrCents: 500000n, tcvCents: 6000000n, probabilityBps: 10000, closedAt: new Date(closedAt), createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
}
describe("OTE individual e administrativo", () => {
  it("mantém salário e OTE individuais, sem expor planos dos colegas", async () => {
    const first = await service.screen(jhon, { month: "2026-10" });
    const second = await service.screen(ede, { month: "2026-10" });
    expect(first.plan).toMatchObject({ fixedCents: "370000", oteCents: "850000" });
    expect(second.plan).toMatchObject({ fixedCents: "250000", oteCents: "530000" });
    expect(JSON.stringify(first)).not.toContain("530000");
    expect((await service.screen(admin, { month: "2026-10" })).plan).toBeNull();
    await expect(service.screen(jhon, { month: "2026-10", memberId: ede.memberId })).rejects.toThrow();
  });
  it("nega administração, falsificação de papel/contexto, outro tenant e outro membro", async () => {
    for (const caller of [jhon, { ...jhon, roleKey: "administrator" }, { ...admin, workspaceId: randomUUID() }, { ...jhon, memberId: ede.memberId }]) {
      await expect(service.administration(caller)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      await expect(service.command(caller, planInput(ede.memberId))).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    }
    await expect(service.command(admin, planInput(randomUUID()))).rejects.toMatchObject({ code: "INVALID_OTE_FACT" });
  });
  it("versiona a vigência, rejeita gravação concorrente e não vaza valores na auditoria", async () => {
    await service.command(admin, planInput(jhon.memberId, { effectiveMonth: "2026-11", fixedCents: "400000" }));
    expect((await service.screen(jhon, { month: "2026-10" })).plan?.fixedCents).toBe("370000");
    expect((await service.screen(jhon, { month: "2026-11" })).plan?.fixedCents).toBe("400000");
    await expect(service.command(admin, planInput(jhon.memberId))).rejects.toMatchObject({ code: "OTE_CONFLICT" });
    const logs = await database.auditLog.findMany({ where: { workspaceId, entityType: "Ote" } });
    expect(JSON.stringify(logs)).not.toMatch(/370000|250000|fixedCents|quotaCents/);
  });
  it("calcula só vendas próprias conferidas, mantém não classificadas pendentes e usa limite mensal local", async () => {
    const mine = await createSale(jhon.memberId);
    const theirs = await createSale(ede.memberId);
    const pending = await createSale(jhon.memberId);
    const previous = await createSale(jhon.memberId, "2026-10-01T02:59:59Z");
    const command = (opportunityId: string) => ({ action: "CLASSIFY_SALE", opportunityId, kind: "ANNUAL_MONTHLY", acvCents: "6000000", selfSourced: false, sdrMemberId: sdr.memberId, evidence: "Contrato sintético conferido", expectedRevision: 0 });
    for (const s of [mine, theirs, previous]) await service.command(admin, command(s.id));
    const result = await service.screen(jhon, { month: "2026-10" });
    expect(result.sales.map((s) => s.id)).toEqual([mine.id]);
    expect(result.sales.map((s) => s.id)).not.toContain(pending.id);
    expect(result.pendingSales).toBe(1);
    expect(result.summary).toMatchObject({ newAcvCents: "6000000", commissionCents: "360000", bonusCents: "120000", totalCents: "850000", eligibleCents: "0" });
    expect(result.sales[0]?.schedule.map((s) => s.amountCents)).toEqual(["126000", "108000", "126000"]);
    await expect(service.command(admin, command(mine.id))).rejects.toMatchObject({ code: "OTE_CONFLICT" });
    expect((await database.oteSale.count({ where: { workspaceId, opportunityId: mine.id } }))).toBe(1);
  });
  it("credita SDR por origem confirmada e reunião realizada e qualificada, sem mostrar comissão do closer", async () => {
    const sale = await database.opportunity.findFirstOrThrow({ where: { workspaceId, ownerMemberId: jhon.memberId, status: "WON" } });
    const meeting = await database.meeting.create({ data: { workspaceId, leadId: sale.leadId, ownerMemberId: jhon.memberId, title: "Reunião OTE sintética", status: "COMPLETED", startsAt: new Date("2026-10-10T12:00:00Z"), endsAt: new Date("2026-10-10T12:30:00Z"), completedAt: new Date("2026-10-10T12:30:00Z"), durationMinutes: 30, timeZone: "America/Sao_Paulo", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const input = { action: "QUALIFY_MEETING", meetingId: meeting.id, sdrMemberId: sdr.memberId, qualified: true, evidence: "Reunião realizada e qualificada conferida", expectedRevision: 0 };
    await service.command(admin, input);
    const result = await service.screen(sdr, { month: "2026-10" });
    expect(result.plan?.oteCents).toBe("320000");
    expect(result.summary).toMatchObject({ meetingCount: 1, saleCount: 2, commissionCents: "24000" });
    expect(result.sales.every((s) => s.projectedCents === "10000" && s.acvCents === "0")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("370000");
    await service.command(admin, { ...input, qualified: false, expectedRevision: 1 });
    expect((await service.screen(sdr, { month: "2026-10" })).summary?.meetingCount).toBe(0);
    await database.meeting.update({ where: { id: meeting.id }, data: { status: "NO_SHOW", completedAt: null, noShowAt: now } });
    await expect(service.command(admin, { ...input, expectedRevision: 2 })).rejects.toMatchObject({ code: "INVALID_OTE_FACT" });
  });
});
