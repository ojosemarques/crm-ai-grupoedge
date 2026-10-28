import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required");
const db = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!) });
const sql = readFileSync(new URL("../../scripts/sql/correct-advertising-meetings.sql", import.meta.url), "utf8");
let workspaceId: string;
let request: Record<string, unknown>;
let targetIds: string[];
let unrelatedBefore: unknown;

async function run(input: Record<string, unknown>) {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('crm.advertising_repair',${JSON.stringify(input)},true)`;
    await tx.$executeRawUnsafe(sql);
  }, { timeout: 30_000 });
}

beforeAll(async () => {
  await seedDemoDatabase(db, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" });
  workspaceId = (await db.workspace.findUniqueOrThrow({ where: { slug: "politizai" } })).id;
  const actor = await db.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } });
  await ensureAdvertisingPipeline(db, workspaceId, actor.id);
  const pipeline = await db.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Anúncios" } });
  const stages = await db.pipelineStage.findMany({ where: { workspaceId, pipelineId: pipeline.id } });
  const stage = stages.find((row) => row.leadStageCode === "NEW")!;
  const scheduled = stages.find((row) => row.leadStageCode === "MEETING_SCHEDULED")!;
  const manual = await db.leadSource.findFirstOrThrow({ where: { workspaceId, key: "manual" } });
  const members = await db.workspaceMember.findMany({ where: { workspaceId, role: { key: "closer" }, deletedAt: null } });
  const old = new Date("2020-01-01T12:00:00Z");
  const rows = [];
  for (let index = 0; index < 3; index++) {
    const current = index === 1 ? scheduled : stage;
    const lead = await db.lead.create({ data: { workspaceId, sourceId: manual.id, pipelineId: pipeline.id, currentStageId: current.id, ownerMemberId: members[0]!.id,
      fullName: `Reparo sintético ${index}`, normalizedPhone: `+551198765430${index}`, status: index === 1 ? "QUALIFIED" : "OPEN",
      slaStartedAt: old, slaDueAt: old, lastActivityAt: old, createdAt: old, createdByActorId: actor.id, updatedByActorId: actor.id } });
    await db.stageHistory.create({ data: { workspaceId, pipelineId: pipeline.id, stageId: current.id, leadId: lead.id, enteredAt: old, enteredByActorId: actor.id } });
    rows.push(lead);
  }
  const meeting = await db.meeting.create({ data: { workspaceId, leadId: rows[1]!.id, ownerMemberId: members[0]!.id, title: "Agenda sintética existente", startsAt: old,
    endsAt: new Date(old.getTime() + 1_800_000), durationMinutes: 30, timeZone: "America/Sao_Paulo", revision: 3, createdByActorId: actor.id, updatedByActorId: actor.id } });
  const history = await db.meetingHistory.create({ data: { workspaceId, meetingId: meeting.id, leadId: rows[1]!.id, ownerMemberId: members[0]!.id,
    meetingRevision: 3, action: "SCHEDULED", newStatus: "SCHEDULED", newStartsAt: old, newEndsAt: meeting.endsAt, occurredAt: old, recordedByActorId: actor.id } });
  const meetingTask = await db.task.create({ data: { workspaceId, leadId: rows[1]!.id, meetingId: meeting.id, assigneeMemberId: members[0]!.id,
    title: "Reunião sintética", kind: "MEETING", dueAt: old, createdByActorId: actor.id, updatedByActorId: actor.id } });
  await db.lead.update({ where: { id: rows[1]!.id }, data: { nextActionTaskId: meetingTask.id, nextActionAt: old, nextActionDescription: meetingTask.title } });
  await recordCommercialMetricFactInTransaction(db, { workspaceId, eventKey: `meeting-history:${history.id}:scheduled:v1`, eventType: "MEETING_SCHEDULED", occurredAt: old,
    sourceEntityType: "MeetingHistory", sourceEntityId: history.id, leadId: rows[1]!.id, meetingId: meeting.id, pipelineId: pipeline.id, meetingOwnerMemberIdAtEvent: members[0]!.id });
  const contact = await db.contact.create({ data: { workspaceId, preferredName: "Contato sintético relacionado", origin: "MANUAL", createdByActorId: actor.id, updatedByActorId: actor.id } });
  await db.contactPoint.create({ data: { workspaceId, contactId: contact.id, type: "PHONE", originalValue: "+5511987654303", normalizedValue: "+5511987654303", source: "MANUAL", createdByActorId: actor.id, updatedByActorId: actor.id } });
  const prospecting = await db.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Prospecção Ativa" } });
  const prospectingStage = await db.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: prospecting.id, leadStageCode: "NEW" } });
  const related = await db.lead.create({ data: { workspaceId, contactId: contact.id, sourceId: manual.id, pipelineId: prospecting.id, currentStageId: prospectingStage.id, ownerMemberId: members[0]!.id,
    fullName: "Contato sintético relacionado", normalizedPhone: "+5511987654399", slaStartedAt: old, slaDueAt: old, lastActivityAt: old, createdByActorId: actor.id, updatedByActorId: actor.id } });
  targetIds = [...rows.map((row) => row.id), randomUUID(), randomUUID()];
  request = { workspaceId, runId: randomUUID(), mode: "DRY_RUN", items: [
    ...rows.map((row, index) => ({ leadId: row.id, phone: row.normalizedPhone, expectedStageId: row.currentStageId, closerId: members[index === 2 ? 1 : 0]!.id,
      startsAt: `2020-01-02T${index === 0 ? "12:30" : index === 1 ? "14:00" : "17:00"}:00Z`, status: index === 2 ? "NO_SHOW" : "COMPLETED",
      ...(index === 1 ? { meetingId: meeting.id, expectedMeetingRevision: 3 } : {}) })),
    { leadId: targetIds[3], newLead: true, contactId: contact.id, relatedLeadId: related.id, confirmIdentity: true, name: "Contato sintético relacionado", phone: "+5511987654303", closerId: members[0]!.id, startsAt: "2020-01-02T16:30:00Z", status: "NO_SHOW" },
    { leadId: targetIds[4], newLead: true, contactId: randomUUID(), name: "Novo contato sintético", phone: "+5511987654304", closerId: members[0]!.id, startsAt: "2020-01-02T15:00:00Z", status: "NO_SHOW" },
  ] };
  unrelatedBefore = await db.lead.findMany({ where: { workspaceId, id: { notIn: targetIds } }, orderBy: { id: "asc" } });
});
afterAll(async () => db.$disconnect());

describe("reparo pontual de reuniões de Anúncios", () => {
  it("valida sem escrever e rejeita alvo divergente", async () => {
    await run(request);
    expect(await db.meeting.count({ where: { workspaceId, leadId: { in: targetIds } } })).toBe(1);
    const items = request.items as Record<string, unknown>[];
    await expect(run({ ...request, items: [{ ...items[0], expectedStageId: randomUUID() }] })).rejects.toThrow(/REPAIR_STALE_LEAD/);
    await expect(run({ ...request, items: [items[0], items[0]] })).rejects.toThrow(/REPAIR_DUPLICATE_TARGET/);
  });
  it("corrige etapas, reuniões, papéis e entradas, preservando outros leads e a receita", async () => {
    const money = await db.commercialMetricFact.aggregate({ where: { workspaceId }, _sum: { valueCents: true } });
    await run({ ...request, mode: "APPLY" });
    const rows = await db.lead.findMany({ where: { workspaceId, id: { in: targetIds } }, include: { currentStage: true } });
    expect(rows.filter((row) => row.currentStage.leadStageCode === "PROPOSAL")).toHaveLength(2);
    expect(rows.filter((row) => row.currentStage.leadStageCode === "MEETING_NO_SHOW")).toHaveLength(3);
    expect(await db.meeting.count({ where: { workspaceId, leadId: { in: targetIds }, status: "COMPLETED" } })).toBe(2);
    expect(await db.meeting.count({ where: { workspaceId, leadId: { in: targetIds }, status: "NO_SHOW" } })).toBe(3);
    expect(await db.leadSlaCycle.count({ where: { workspaceId, leadId: { in: targetIds.slice(3) } } })).toBe(2);
    expect((await db.lead.findUniqueOrThrow({ where: { id: targetIds[1]! } })).nextActionTaskId).toBeNull();
    expect(await db.task.count({ where: { workspaceId, leadId: targetIds[1]!, status: "COMPLETED" } })).toBe(1);
    const relatedContact = (request.items as Record<string, unknown>[])[3]!.contactId as string;
    expect((await db.contact.findUniqueOrThrow({ where: { id: relatedContact } })).quality).toBe("CONFIRMED");
    expect(await db.commercialMetricFact.aggregate({ where: { workspaceId }, _sum: { valueCents: true } })).toEqual(money);
    expect(await db.lead.findMany({ where: { workspaceId, id: { notIn: targetIds } }, orderBy: { id: "asc" } })).toEqual(unrelatedBefore);
    const groups = await db.commercialMetricFact.groupBy({ by: ["eventType"], where: { workspaceId, leadId: { in: targetIds }, eventType: { in: ["MEETING_SCHEDULED", "MEETING_COMPLETED", "MEETING_NO_SHOW"] } }, _sum: { quantity: true } });
    expect(Object.fromEntries(groups.map((row) => [row.eventType, row._sum.quantity]))).toEqual({ MEETING_SCHEDULED: 5, MEETING_COMPLETED: 2, MEETING_NO_SHOW: 3 });
  });
  it("repete sem novo evento e recusa o reaproveitamento da chave com outro pedido", async () => {
    const before = await db.commercialMetricFact.count({ where: { workspaceId } });
    await run({ ...request, mode: "APPLY" });
    expect(await db.commercialMetricFact.count({ where: { workspaceId } })).toBe(before);
    await expect(run({ ...request, mode: "APPLY", changed: true })).rejects.toThrow(/REPAIR_REPLAY_CONFLICT/);
  });
});
