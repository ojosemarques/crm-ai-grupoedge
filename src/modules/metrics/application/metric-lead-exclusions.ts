import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export const METRIC_LEAD_EXCLUSION_ACTION = "lead.metrics_excluded";

// An explicit, tenant-scoped analytical exclusion never changes operational visibility.
export async function excludedMetricLeadIds(database: Pick<PrismaClient | Prisma.TransactionClient, "auditLog">, workspaceId: string): Promise<string[]> {
  const rows = await database.auditLog.findMany({
    where: { workspaceId, action: METRIC_LEAD_EXCLUSION_ACTION, entityType: "Lead" },
    select: { entityId: true },
  });
  return [...new Set(rows.map((row) => row.entityId))];
}

export function metricFactExclusionFilters(ids: readonly string[]): Prisma.CommercialMetricFactWhereInput[] {
  // Facts without a lead (for example scheduled email jobs) remain reportable.
  return ids.length ? [{ OR: [{ leadId: null }, { leadId: { notIn: [...ids] } }] }] : [];
}

export function metricRelatedLeadFilter(ids: readonly string[]) {
  return { OR: [{ leadId: null }, { leadId: { notIn: [...ids] } }] };
}
