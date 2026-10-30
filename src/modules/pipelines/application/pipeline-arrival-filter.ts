import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDateAt, workspaceDayRange, workspaceWeekRange } from "@/shared/core/time/workspace-time";
import { z } from "zod";

export const pipelineArrivalFields = {
  arrivalPreset: z.enum(["ALL", "TODAY", "WEEK", "CUSTOM"]).default("ALL"),
  arrivalFrom: z.union([z.literal(""), z.iso.date()]).default(""),
  arrivalTo: z.union([z.literal(""), z.iso.date()]).default(""),
};

type ArrivalFilters = { arrivalPreset: "ALL" | "TODAY" | "WEEK" | "CUSTOM"; arrivalFrom: string; arrivalTo: string };

export function pipelineArrivalRange(filters: ArrivalFilters, now: Date, timeZone: string) {
  if (filters.arrivalPreset === "ALL") return null;
  const today = workspaceDateAt(now, timeZone);
  if (filters.arrivalPreset === "TODAY") return workspaceDayRange(today, timeZone);
  if (filters.arrivalPreset === "WEEK") return workspaceWeekRange(today, timeZone);
  if (!filters.arrivalFrom || !filters.arrivalTo || filters.arrivalFrom > filters.arrivalTo) {
    throw new ApplicationError("Informe um período válido: a data inicial deve ser anterior ou igual à final.", {
      code: "INVALID_INPUT", statusCode: 400, expose: true,
    });
  }
  return { start: workspaceDayRange(filters.arrivalFrom, timeZone).start, end: workspaceDayRange(filters.arrivalTo, timeZone).end };
}

/** Filter before stage counts and pagination, retaining the original arrival after imports/completion. */
export async function pipelineArrivalWhere(database: PrismaClient, input: {
  workspaceId: string; pipelineId: string; filters: ArrivalFilters; now: Date; timeZone: string;
}): Promise<Prisma.LeadWhereInput> {
  const range = pipelineArrivalRange(input.filters, input.now, input.timeZone);
  if (!range) return {};
  const rows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT lead.id FROM "leads" lead
    CROSS JOIN LATERAL (
      SELECT LEAST(lead."createdAt", (
        SELECT MIN(LEAST(submission."submittedAt", (
          SELECT MIN(partial."firstAnsweredAt") FROM "marketing_form_partial_responses" partial
          WHERE partial."workspaceId" = lead."workspaceId" AND partial."deletedAt" IS NULL
            AND (partial."receiptId" = submission."marketingFormReceiptId"
              OR submission."idempotencyKey" = 'marketing-form-partial-lead:' || partial.id::text)
        ))) FROM "lead_form_submissions" submission
        WHERE submission."workspaceId" = lead."workspaceId" AND submission."leadId" = lead.id
      )) AS arrived_at
    ) arrival
    WHERE lead."workspaceId" = ${input.workspaceId}
      AND lead."pipelineId" = ${input.pipelineId} AND lead."deletedAt" IS NULL
      AND arrival.arrived_at >= ${range.start} AND arrival.arrived_at < ${range.end}
  `);
  return { id: { in: rows.map((row) => row.id) } };
}
