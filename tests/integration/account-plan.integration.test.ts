import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { cancelIncompatibleAccountPlanActionsInTransaction, createAccountPlanService } from "@/modules/opportunities/application/account-plan-service";
import { createOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { createSalesGateService } from "@/modules/opportunities/application/sales-gate-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for account plan tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const authorization = createAuthorizationService({ database });
let now = new Date("2038-02-10T15:00:00.000Z");
let workspaceId: string; let manager: AuthenticatedContext; let closer: AuthenticatedContext; let system: ServiceActorContext; let productId: string;
const stages = new Map<string, string>(); let phoneSequence = 80_000_000;

async function human(email: string) { const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } }); const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } }); return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext; }
const opportunityService = () => createOpportunityService({ database, authorization, now: () => now });
const planService = () => createAccountPlanService({ database, authorization, now: () => now });
const gateService = () => createSalesGateService({ database, authorization, now: () => now });
const future = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
function futureLocal(days: number) { const date = new Date(now.getTime() + days * 86_400_000); const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }

async function scenario() {
  phoneSequence += 1;
  const intake = await createLeadIntakeService({ database, authorization, now: () => now }).intake({ channel: "MANUAL", idempotencyKey: `stage06:${randomUUID()}`, fullName: "Venda longa institucional", phone: `+55119${phoneSequence.toString().slice(-8)}`, interestSummary: "Programa consultivo plurimensal", sourceKey: "manual", priorityBandCode: "P1", rawPayload: { test: "stage06" } }, system);
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  const meeting = await database.meeting.create({ data: { workspaceId, leadId: intake.leadId, ownerMemberId: closer.memberId, title: "Diagnóstico", status: "COMPLETED", startsAt: new Date(now.getTime() - 3_600_000), endsAt: new Date(now.getTime() - 1_800_000), durationMinutes: 30, timeZone: "America/Sao_Paulo", completedAt: now, outcome: "Realizado", createdByActorId: manager.actorId, updatedByActorId: manager.actorId } });
  const created = await opportunityService().create(manager, { leadId: intake.leadId, meetingId: meeting.id, ownerMemberId: closer.memberId, productId, name: "Mandato de longo ciclo", amountCents: "500000", mrrCents: "0", tcvCents: "500000", probabilityPercent: 50, nextAction: { title: "Próximo compromisso", dueAtLocal: futureLocal(5) } });
  const moved = await opportunityService().transition(manager, { action: "TRANSITION", opportunityId: created.opportunityId, targetStageId: stages.get("OPPORTUNITY_CONFIRMED"), expectedRevision: 1, reason: "Oportunidade confirmada", origin: "OPPORTUNITY_CARD", confirmed: false, lossReasonId: null }) as { revision: number };
  return { leadId: intake.leadId, opportunityId: created.opportunityId, revision: moved.revision };
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database); workspaceId = seeded.workspaceId;
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } }); system = { workspaceId, actorId: actor.id, actorKey: "system", actorType: "SYSTEM" };
  [manager, closer] = await Promise.all([human("gestor@demo.politizai.local"), human("closer1@demo.politizai.local")]);
  productId = (await database.product.create({ data: { workspaceId, sku: "LONG-STAGE06", name: "Programa institucional", salesGateProfile: "STANDARD", listPriceCents: 500000n, createdByActorId: actor.id, updatedByActorId: actor.id } })).id;
  const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true }, include: { stages: { where: { deletedAt: null } } } }); pipeline.stages.forEach((stage) => stages.set(stage.opportunityStageCode ?? "", stage.id));
});
afterAll(async () => database.$disconnect());

describe("cadência longa e plano de conta", () => {
  it("mantém um card, versiona proposta/trilha, preserva stakeholder e retoma espera sem duplicar ações", async () => {
    const created = await scenario(); const messagesBefore = await database.message.count({ where: { workspaceId } }); const opportunityCount = await database.opportunity.count({ where: { workspaceId, id: created.opportunityId } });
    let planRevision = 0;
    const episode = await planService().command(manager, created.opportunityId, { action: "START_EPISODE", type: "DISCOVERY", title: "Descoberta institucional", objective: "Mapear o mandato e atores", ownerMemberId: closer.memberId, dueAt: future(10), artifactUrl: null, expectedRevision: planRevision, idempotencyKey: `stage06:episode:${randomUUID()}` }) as unknown as { revision: number; episodeId: string }; planRevision = episode.revision;
    for (const [type, milestone] of [["STAKEHOLDER", "Chefe de gabinete mapeado"], ["POLITIZAI_DELIVERY", "Diagnóstico entregue"], ["IMPEDIMENT", "Parecer jurídico pendente"], ["DECISION", "Comitê agenda deliberação"]] as const) {
      const result = await planService().command(manager, created.opportunityId, { action: "UPSERT_TRACK", type, milestone, artifactTitle: type === "POLITIZAI_DELIVERY" ? "Proposta v1" : null, artifactUrl: null, ownerMemberId: type === "IMPEDIMENT" ? null : closer.memberId, dueAt: future(15), expectedRevision: planRevision, idempotencyKey: `stage06:track:${type}:${randomUUID()}` }) as { revision: number }; planRevision = result.revision;
    }
    const stakeholder = await planService().command(manager, created.opportunityId, { action: "CHANGE_STAKEHOLDER", name: "Ana", role: "Chefe de gabinete", isDecisionMaker: true, expectedRevision: planRevision, idempotencyKey: `stage06:stakeholder:${randomUUID()}` }) as unknown as { revision: number; stakeholderId: string }; planRevision = stakeholder.revision;
    const changed = await planService().command(manager, created.opportunityId, { action: "CHANGE_STAKEHOLDER", name: "Bruno", role: "Novo chefe de gabinete", isDecisionMaker: true, replacesStakeholderId: stakeholder.stakeholderId, expectedRevision: planRevision, idempotencyKey: `stage06:stakeholder:${randomUUID()}` }) as { revision: number }; planRevision = changed.revision;
    const revised = await planService().command(manager, created.opportunityId, { action: "UPSERT_TRACK", type: "POLITIZAI_DELIVERY", milestone: "Proposta revisada entregue", artifactTitle: "Proposta v2", artifactUrl: null, ownerMemberId: closer.memberId, dueAt: future(20), expectedRevision: planRevision, idempotencyKey: `stage06:proposal-v2:${randomUUID()}` }) as { revision: number }; planRevision = revised.revision;
    let opportunityRevision = created.revision;
    const proposal1 = await opportunityService().registerProposal(manager, { action: "PROPOSAL", opportunityId: created.opportunityId, expectedRevision: opportunityRevision, productId, offerTemplateId: null, name: "Proposta v1", quantity: 1, unitPriceCents: "500000", discountCents: "0", confirmed: true }) as { revision: number }; opportunityRevision = proposal1.revision;
    const proposal2 = await opportunityService().registerProposal(manager, { action: "PROPOSAL", opportunityId: created.opportunityId, expectedRevision: opportunityRevision, productId, offerTemplateId: null, name: "Proposta v2", quantity: 1, unitPriceCents: "550000", discountCents: "0", confirmed: true }) as { revision: number }; opportunityRevision = proposal2.revision;
    const customerWait = await planService().command(manager, created.opportunityId, { action: "START_EPISODE", type: "CUSTOMER_WAIT", title: "Aguardar deliberação do cliente", objective: "Retomar somente na data pactuada", ownerMemberId: closer.memberId, dueAt: future(30), artifactUrl: null, expectedRevision: planRevision, idempotencyKey: `stage06:customer-wait:${randomUUID()}` }) as unknown as { revision: number; episodeId: string }; planRevision = customerWait.revision;
    const waitKey = `stage06:wait:${randomUUID()}`;
    const waiting = await planService().command(manager, created.opportunityId, { action: "PLAN_WAIT", reason: "Cliente pactuou retorno após sessão legislativa", reviewAt: future(30), ownerMemberId: closer.memberId, expectedRevision: planRevision, idempotencyKey: waitKey }) as unknown as { revision: number; waitId: string }; planRevision = waiting.revision;
    const replay = await planService().command(manager, created.opportunityId, { action: "PLAN_WAIT", reason: "Cliente pactuou retorno após sessão legislativa", reviewAt: future(30), ownerMemberId: closer.memberId, expectedRevision: planRevision - 1, idempotencyKey: waitKey }) as { idempotent: boolean; waitId: string }; expect(replay).toMatchObject({ idempotent: true, waitId: waiting.waitId });
    await database.opportunity.update({ where: { id: created.opportunityId }, data: { nextActionAt: new Date(now.getTime() - 10 * 86_400_000) } });
    await gateService().scanReviews(manager, { action: "SCAN", staleHours: 24, maxStageDays: 1 });
    expect(await database.processViolation.count({ where: { workspaceId, opportunityId: created.opportunityId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, type: { in: ["OPPORTUNITY_STAGNANT", "OPPORTUNITY_STAGE_OVERDUE"] } } })).toBe(0);
    now = new Date(now.getTime() + 31 * 86_400_000);
    const queue = await planService().getCommitments(manager); expect(queue.items.some((item) => item.opportunityId === created.opportunityId && item.kind === "WAIT" && item.overdue)).toBe(true); expect(queue.items.some((item) => item.unassigned && item.kind === "TRACK")).toBe(true);
    const response = await planService().command(manager, created.opportunityId, { action: "REGISTER_EVENT", event: "RESPONSE", expectedRevision: planRevision, idempotencyKey: `stage06:response:${randomUUID()}` }) as { revision: number }; planRevision = response.revision;
    const screen = await planService().getScreen(manager, created.opportunityId); expect(screen.plannedWait).toBeNull();
    expect(await database.opportunityPlanEpisode.findUniqueOrThrow({ where: { id: customerWait.episodeId } })).toMatchObject({ status: "CANCELLED", cancellationCode: "RESPONSE" });
    expect(await database.opportunityPlannedWait.findUniqueOrThrow({ where: { id: waiting.waitId } })).toMatchObject({ status: "RESUMED", cancellationCode: "RESPONSE" });
    const responseTasks = await database.task.findMany({ where: { workspaceId, opportunityId: created.opportunityId, title: "Tratar resposta do cliente", status: "OPEN" } }); expect(responseTasks).toHaveLength(1); expect((await database.opportunity.findUniqueOrThrow({ where: { id: created.opportunityId } })).nextActionTaskId).toBe(responseTasks[0]!.id);
    expect(await database.opportunityAccountPlan.count({ where: { workspaceId, opportunityId: created.opportunityId } })).toBe(1);
    expect(await database.opportunityPlanTrackRevision.findMany({ where: { workspaceId, opportunityId: created.opportunityId, track: { type: "POLITIZAI_DELIVERY" } }, orderBy: { revision: "asc" }, select: { revision: true, artifactTitle: true } })).toEqual([{ revision: 1, artifactTitle: "Proposta v1" }, { revision: 2, artifactTitle: "Proposta v2" }]);
    expect((await database.opportunityPlanStakeholder.findMany({ where: { workspaceId, opportunityId: created.opportunityId }, orderBy: { startedAt: "asc" }, select: { name: true, status: true } })).map((x) => x.status)).toEqual(["REPLACED", "ACTIVE"]);
    expect(await database.offer.count({ where: { workspaceId, opportunityId: created.opportunityId } })).toBe(2); expect(await database.opportunity.count({ where: { workspaceId, id: created.opportunityId } })).toBe(opportunityCount); expect(await database.message.count({ where: { workspaceId } })).toBe(messagesBefore);
    expect(await database.cadenceStep.count({ where: { workspaceId } })).toBeGreaterThan(0);
    const optOutEpisode = await planService().command(manager, created.opportunityId, { action: "START_EPISODE", type: "INSTITUTIONAL_NURTURE", title: "Nutrição institucional", objective: "Acompanhar pauta futura", ownerMemberId: closer.memberId, dueAt: future(5), artifactUrl: null, expectedRevision: planRevision, idempotencyKey: `stage06:optout-episode:${randomUUID()}` }) as unknown as { revision: number; episodeId: string }; planRevision = optOutEpisode.revision;
    const optOutWait = await planService().command(manager, created.opportunityId, { action: "PLAN_WAIT", reason: "Aguardar autorização de contato", reviewAt: future(10), ownerMemberId: closer.memberId, expectedRevision: planRevision, idempotencyKey: `stage06:optout-wait:${randomUUID()}` }) as unknown as { revision: number; waitId: string }; planRevision = optOutWait.revision;
    const optOut = await planService().command(manager, created.opportunityId, { action: "REGISTER_EVENT", event: "OPT_OUT", expectedRevision: planRevision, idempotencyKey: `stage06:optout:${randomUUID()}` }) as unknown as { revision: number }; planRevision = optOut.revision;
    expect(await database.lead.findUniqueOrThrow({ where: { id: created.leadId } })).toMatchObject({ contactPreference: "DO_NOT_CONTACT" });
    expect(await database.opportunityPlanEpisode.findUniqueOrThrow({ where: { id: optOutEpisode.episodeId } })).toMatchObject({ status: "CANCELLED", cancellationCode: "OPT_OUT" });
    expect(await database.opportunityPlannedWait.findUniqueOrThrow({ where: { id: optOutWait.waitId } })).toMatchObject({ status: "CANCELLED", cancellationCode: "OPT_OUT" });
    for (const event of ["WON", "LOST"] as const) {
      const active = await planService().command(manager, created.opportunityId, { action: "START_EPISODE", type: "CONTRACTING", title: `Compromisso antes de ${event}`, objective: "Confirmar cancelamento transacional", ownerMemberId: closer.memberId, dueAt: future(3), artifactUrl: null, expectedRevision: planRevision, idempotencyKey: `stage06:${event}:${randomUUID()}` }) as unknown as { revision: number; episodeId: string }; planRevision = active.revision;
      await database.$transaction((tx) => cancelIncompatibleAccountPlanActionsInTransaction(tx, { workspaceId, opportunityId: created.opportunityId, actorId: manager.actorId, at: now, event }));
      expect(await database.opportunityPlanEpisode.findUniqueOrThrow({ where: { id: active.episodeId } })).toMatchObject({ status: "CANCELLED", cancellationCode: event });
      planRevision = (await database.opportunityAccountPlan.findUniqueOrThrow({ where: { workspaceId_opportunityId: { workspaceId, opportunityId: created.opportunityId } } })).revision;
    }
    expect(await database.message.count({ where: { workspaceId } })).toBe(messagesBefore);
    expect(opportunityRevision).toBeGreaterThan(created.revision); expect(planRevision).toBeGreaterThan(0);
  });
});
