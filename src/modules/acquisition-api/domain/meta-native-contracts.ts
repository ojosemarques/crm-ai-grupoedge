import { z } from "zod";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

export const metaIdSchema = z.string().regex(/^\d{3,40}$/);
export const metaNativeConfigurationSchema = z.object({
  pageId: metaIdSchema,
  businessId: metaIdSchema,
  pipelineId: z.string().uuid(),
  initialStageId: z.string().uuid(),
  importFrom: z.iso.datetime(),
  forms: z.array(z.object({ id: metaIdSchema, name: z.string().min(1).max(200), status: z.string().max(40) }).strict()).max(500).default([]),
  datasetId: metaIdSchema.optional(),
  fieldMapping: z.partialRecord(z.enum(["jobTitle", "organizationName", "city", "stateCode", "interestSummary"]), z.string().min(1).max(300)).default({}),
}).strict();

export type MetaNativeConfiguration = z.infer<typeof metaNativeConfigurationSchema>;

export function saoPauloDay(now: Date) {
  return workspaceDayRange(workspaceDateAt(now, "America/Sao_Paulo"), "America/Sao_Paulo");
}
