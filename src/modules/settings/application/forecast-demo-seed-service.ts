import { createHash } from "node:crypto";
import type { ForecastCategory, PrismaClient } from "@/generated/prisma/client";
import { aggregateForecast, forecastFingerprint } from "@/modules/forecast/domain/forecast-contracts";

function stableId(key: string) { const hash = createHash("sha256").update(`politizai-crm56:${key}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`; }

export async function seedForecastDemoData(database: PrismaClient) {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const system = await database.actor.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: workspace.id, key: "system" } } });
  const plan = await database.goalPlan.findFirstOrThrow({ where: { workspaceId: workspace.id, key: "metas-mensais-2026-09", status: "PUBLISHED" } });
  const team = await database.team.findFirstOrThrow({ where: { workspaceId: workspace.id, name: "Vendas", deletedAt: null } });
  const members = await database.workspaceMember.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", deletedAt: null, teamMemberships: { some: { teamId: team.id, function: "CLOSER", deletedAt: null } } }, include: { user: true }, orderBy: [{ user: { normalizedEmail: "asc" } }, { id: "asc" }] });
  const manager = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, role: { key: "commercial_manager" }, deletedAt: null } });
  const candidates = await database.opportunity.findMany({ where: { workspaceId: workspace.id, ownerMemberId: { in: members.map((item) => item.id) }, status: "OPEN", amountCents: { gt: 0 }, currency: "BRL", expectedCloseAt: { gte: plan.periodStart, lt: plan.periodEnd }, deletedAt: null }, include: { currentStage: true, owner: { include: { user: true } } }, orderBy: [{ expectedCloseAt: "asc" }, { id: "asc" }] });
  const first = members[0] ? candidates.find((row) => row.ownerMemberId === members[0]!.id) : undefined;
  const second = members[1] ? candidates.find((row) => row.ownerMemberId === members[1]!.id && row.id !== first?.id) : undefined;
  const third = candidates.find((row) => row.id !== first?.id && row.id !== second?.id);
  if (members.length < 2 || !first || !second || !third) throw new Error("Dados mínimos de closers/oportunidades ausentes para seed CRM-56.");
  const rows = [first, second, third] as const;
  await database.opportunityEvidence.createMany({
    data: rows.map((row) => ({
      id: stableId(`evidence:${row.id}:diagnosis:v1`),
      workspaceId: workspace.id,
      opportunityId: row.id,
      type: "DIAGNOSIS",
      version: 1,
      summary: "Diagnóstico fictício confirmado para o forecast demonstrativo.",
      idempotencyKey: `crm56:seed:evidence:${row.id}:diagnosis:v1`,
      confirmedAt: new Date("2026-09-05T15:00:00.000Z"),
      recordedByActorId: system.id,
      createdAt: new Date("2026-09-05T15:00:00.000Z"),
    })),
    skipDuplicates: true,
  });
  const cycleId = stableId("cycle:2026-09:sales:v1");
  if (!await database.forecastCycle.findUnique({ where: { id: cycleId } })) await database.forecastCycle.create({ data: { id: cycleId, workspaceId: workspace.id, goalPlanId: plan.id, key: "forecast-vendas-2026-09", version: 1, name: "Forecast comercial — setembro de 2026", periodStart: plan.periodStart, periodEnd: plan.periodEnd, timeZone: plan.timeZone, scopeType: "TEAM", teamId: team.id, currency: "BRL", status: "OPEN", idempotencyKey: "crm56:seed:cycle:2026-09", createdByActorId: system.id, updatedByActorId: system.id, createdAt: plan.periodStart, updatedAt: plan.periodStart } });

  const cut1 = new Date("2026-09-06T15:00:00.000Z");
  const cut2 = new Date("2026-09-13T15:00:00.000Z");
  const cuts = [cut1, cut2] as const;
  const submissionSpecs = [
    { id: stableId("submission:closer1:commit:v1"), author: members[0]!, category: "COMMIT" as const, selected: [rows[0]!.id], declared: rows[0]!.amountCents, createdAt: cut1 },
    { id: stableId("submission:closer2:best:v1"), author: members[1]!, category: "BEST_CASE" as const, selected: [rows[1]!.id], declared: rows[1]!.amountCents, createdAt: cut1 },
  ];
  for (const spec of submissionSpecs) if (!await database.forecastSubmission.findUnique({ where: { id: spec.id } })) {
    const owned = rows.filter((row) => row.ownerMemberId === spec.author.id);
    const fingerprint = forecastFingerprint({ category: spec.category, selected: spec.selected, rows: owned.map((row) => ({ id: row.id, amount: row.amountCents, revision: row.revision })) });
    await database.forecastSubmission.create({ data: { id: spec.id, workspaceId: workspace.id, cycleId, authorMemberId: spec.author.id, scopeType: "MEMBER", targetMemberId: spec.author.id, type: "INDIVIDUAL", category: spec.category, declaredValueCents: spec.declared, currency: "BRL", comment: "Leitura individual fictícia do seed CRM-56.", asOf: spec.createdAt, version: 1, fingerprint, idempotencyKey: `crm56:seed:${spec.category.toLowerCase()}:${spec.author.id}`, createdByActorId: system.id, createdAt: spec.createdAt, items: { create: owned.map((row) => ({ cycleId, opportunityId: row.id, included: spec.selected.includes(row.id), category: spec.selected.includes(row.id) ? spec.category : null, exclusionReason: spec.selected.includes(row.id) ? null : "NOT_DECLARED_FOR_CATEGORY", opportunityName: row.name, leadId: row.leadId, accountId: row.accountId, ownerMemberId: row.ownerMemberId, ownerLabel: row.owner.user.displayName, teamId: team.id, teamLabel: team.name, stageId: row.currentStageId, stageKey: row.currentStage.opportunityStageCode ?? row.currentStage.id, stageLabel: row.currentStage.name, status: row.status, amountCents: row.amountCents, currency: row.currency, expectedCloseAt: row.expectedCloseAt, probabilityBps: row.probabilityBps, probabilitySource: "OPPORTUNITY_MANUAL", probabilityActorId: row.updatedByActorId, probabilityRecordedAt: row.updatedAt, opportunityRevision: row.revision, opportunityUpdatedAt: row.updatedAt, createdAt: spec.createdAt })) } } });
  }
  const overrideId = stableId("submission:manager:commit:v1");
  if (!await database.forecastSubmission.findUnique({ where: { id: overrideId } })) await database.forecastSubmission.create({ data: { id: overrideId, workspaceId: workspace.id, cycleId, authorMemberId: manager.id, scopeType: "TEAM", targetTeamId: team.id, type: "MANAGER_OVERRIDE", category: "COMMIT", declaredValueCents: rows[0]!.amountCents + 50_000n, currency: "BRL", comment: "Override fictício: negociação avançada confirmada em reunião gerencial.", asOf: cut2, version: 1, fingerprint: forecastFingerprint({ type: "MANAGER_OVERRIDE", teamId: team.id, value: rows[0]!.amountCents + 50_000n }), idempotencyKey: "crm56:seed:manager-override:commit", createdByActorId: system.id, createdAt: cut2, items: { create: rows.map((row) => ({ cycleId, opportunityId: row.id, included: false, category: null, exclusionReason: "AGGREGATE_OVERRIDE", opportunityName: row.name, leadId: row.leadId, accountId: row.accountId, ownerMemberId: row.ownerMemberId, ownerLabel: row.owner.user.displayName, teamId: team.id, teamLabel: team.name, stageId: row.currentStageId, stageKey: row.currentStage.opportunityStageCode ?? row.currentStage.id, stageLabel: row.currentStage.name, status: row.status, amountCents: row.amountCents, currency: row.currency, expectedCloseAt: row.expectedCloseAt, probabilityBps: row.probabilityBps, probabilitySource: "OPPORTUNITY_MANUAL", probabilityActorId: row.updatedByActorId, probabilityRecordedAt: row.updatedAt, opportunityRevision: row.revision, opportunityUpdatedAt: row.updatedAt, createdAt: cut2 })) } } });

  const snapshotCategories: ForecastCategory[][] = [["PIPELINE", "BEST_CASE"], ["COMMIT", "BEST_CASE", "PIPELINE"]];
  for (let index = 0; index < cuts.length; index += 1) {
    const snapshotId = stableId(`snapshot:${index + 1}`);
    if (await database.forecastSnapshot.findUnique({ where: { id: snapshotId } })) continue;
    const selectedRows = rows.slice(0, index === 0 ? 2 : 3);
    const facts = selectedRows.map((row, rowIndex) => ({ id: row.id, status: row.status, amountCents: index === 0 && rowIndex === 0 ? row.amountCents - 10_000n : row.amountCents, currency: row.currency, expectedCloseAt: row.expectedCloseAt, ownerMemberId: row.ownerMemberId, teamId: team.id, category: snapshotCategories[index]![rowIndex]!, probabilityBps: row.probabilityBps, probabilitySource: "OPPORTUNITY_MANUAL", probabilityActorId: row.updatedByActorId, probabilityRecordedAt: row.updatedAt }));
    const totals = aggregateForecast(facts);
    const fingerprint = forecastFingerprint({ cycleId, asOf: cuts[index], facts });
    await database.forecastSnapshot.create({ data: { id: snapshotId, workspaceId: workspace.id, cycleId, sequence: index + 1, asOf: cuts[index]!, periodStart: plan.periodStart, periodEnd: plan.periodEnd, timeZone: plan.timeZone, scopeType: "TEAM", scopeKey: `TEAM:${team.id}`, teamId: team.id, currency: "BRL", realizedCents: 0n, goalTargetCents: 12_000_000n, ...totals, bottomUpCommitCents: index === 0 ? 0n : rows[0]!.amountCents, managerOverrideCents: index === 0 ? null : rows[0]!.amountCents + 50_000n, managerOverrideId: index === 0 ? null : overrideId, fingerprint, filters: { teamId: team.id, demo: true }, sourceSubmissionIds: submissionSpecs.map((item) => item.id), idempotencyKey: `crm56:seed:snapshot:${index + 1}`, createdByActorId: system.id, createdAt: cuts[index]!, items: { create: facts.map((fact, rowIndex) => { const row = selectedRows[rowIndex]!; return { cycleId, opportunityId: row.id, eligible: true, category: fact.category, reasonCode: "ELIGIBLE", opportunityName: row.name, leadId: row.leadId, accountId: row.accountId, ownerMemberId: row.ownerMemberId, ownerLabel: row.owner.user.displayName, teamId: team.id, teamLabel: team.name, stageId: row.currentStageId, stageKey: row.currentStage.opportunityStageCode ?? row.currentStage.id, stageLabel: row.currentStage.name, status: row.status, amountCents: fact.amountCents, currency: row.currency, expectedCloseAt: row.expectedCloseAt, probabilityBps: row.probabilityBps, probabilitySource: "OPPORTUNITY_MANUAL", probabilityActorId: row.updatedByActorId, probabilityRecordedAt: row.updatedAt, opportunityRevision: row.revision, opportunityUpdatedAt: row.updatedAt, sourceSubmissionId: rowIndex < 2 ? submissionSpecs[rowIndex]!.id : null, createdAt: cuts[index]! }; }) } } });
  }
  return { cycles: 1, submissions: 3, snapshots: 2, snapshotItems: 5 };
}
