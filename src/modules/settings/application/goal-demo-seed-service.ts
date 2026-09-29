import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

function stableId(key: string) { const hash = createHash("sha256").update(`politizai-crm55:${key}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`; }

export async function seedGoalDemoData(database: PrismaClient) {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
  const actor = await database.actor.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: workspace.id, key: "system" } } });
  const members = await database.workspaceMember.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", deletedAt: null }, include: { user: true, role: true } });
  const teams = await database.team.findMany({ where: { workspaceId: workspace.id, deletedAt: null } });
  const sdr = members.find((item) => item.role.key === "sdr");
  const sales = teams.find((item) => item.name === "Vendas");
  if (!sdr || !sales) throw new Error("Estrutura mínima ausente para seed CRM-55.");
  const planId = stableId("plan:monthly-2026-09:v1");
  const plan = await database.goalPlan.upsert({ where: { id: planId }, create: { id: planId, workspaceId: workspace.id, key: "metas-mensais-2026-09", version: 1, name: "Metas comerciais — setembro de 2026", description: "Cenário fictício e rastreável para demonstração local.", periodStart: new Date("2026-09-01T03:00:00.000Z"), periodEnd: new Date("2026-10-01T03:00:00.000Z"), timeZone: workspace.timeZone, status: "PUBLISHED", publishedAt: new Date("2026-09-01T03:00:00.000Z"), idempotencyKey: "crm55:seed:monthly-2026-09:v1", createdByActorId: actor.id, updatedByActorId: actor.id }, update: {} });
  const quotaRows = [
    { suffix: "sdr-leads", targetType: "MEMBER" as const, targetKey: `MEMBER:${sdr.id}`, memberId: sdr.id, teamId: null, function: null, metricKey: "LEADS_ASSIGNED" as const, unit: "COUNT" as const, targetValue: 45n, currency: null, targetLabel: sdr.user.displayName },
    { suffix: "team-sales", targetType: "TEAM" as const, targetKey: `TEAM:${sales.id}`, memberId: null, teamId: sales.id, function: null, metricKey: "OPPORTUNITIES_WON" as const, unit: "COUNT" as const, targetValue: 12n, currency: null, targetLabel: sales.name },
    { suffix: "closer-revenue", targetType: "FUNCTION" as const, targetKey: "FUNCTION:CLOSER", memberId: null, teamId: null, function: "CLOSER" as const, metricKey: "REVENUE_WON_CENTS" as const, unit: "CURRENCY_CENTS" as const, targetValue: 12_000_000n, currency: "BRL" as const, targetLabel: "Closer" },
    { suffix: "farmer-expansion", targetType: "FUNCTION" as const, targetKey: "FUNCTION:FARMER", memberId: null, teamId: null, function: "FARMER" as const, metricKey: "EXPANSION_MRR_CENTS" as const, unit: "CURRENCY_CENTS" as const, targetValue: 500_000n, currency: "BRL" as const, targetLabel: "Farmer" },
  ];
  for (const quota of quotaRows) {
    const { suffix, ...data } = quota;
    await database.goalQuota.upsert({ where: { id: stableId(`quota:${suffix}`) }, create: { id: stableId(`quota:${suffix}`), workspaceId: workspace.id, planId, ...data, createdByActorId: actor.id, updatedByActorId: actor.id }, update: {} });
  }
  await database.goalPlanEvent.upsert({ where: { id: stableId("event:plan-published") }, create: { id: stableId("event:plan-published"), workspaceId: workspace.id, planId, sequence: 1, type: "PUBLISHED", reason: "Plano fictício publicado pelo seed CRM-55.", snapshot: { demo: true, quotaCount: quotaRows.length }, actorId: actor.id, idempotencyKey: "crm55:seed:plan-published", occurredAt: new Date("2026-09-01T03:00:00.000Z") }, update: {} });
  return { planId: plan.id, plans: 1, quotas: quotaRows.length };
}
