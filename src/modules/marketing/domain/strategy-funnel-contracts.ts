import { z } from "zod";

export const strategyNodeTypes = ["LANDING_PAGE", "FORM", "WHATSAPP", "COMMERCIAL_STAGE"] as const;
export type StrategyNodeType = typeof strategyNodeTypes[number];

export const strategyFunnelNodeSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(strategyNodeTypes),
  label: z.string().trim().min(1).max(120),
  referenceId: z.string().uuid().nullable(),
}).strict().superRefine((value, context) => {
  if (value.type === "WHATSAPP" && value.referenceId) context.addIssue({ code: "custom", path: ["referenceId"], message: "WhatsApp não aceita referência externa." });
  if (value.type !== "WHATSAPP" && !value.referenceId) context.addIssue({ code: "custom", path: ["referenceId"], message: "Selecione o registro desta etapa." });
});

export const strategyFunnelDefinitionSchema = z.object({
  schema: z.literal("strategy.funnel/v1"),
  nodes: z.array(strategyFunnelNodeSchema).min(2).max(20),
}).strict().superRefine((value, context) => {
  const ids = value.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["nodes"], message: "As etapas precisam de identificadores únicos." });
});

const base = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  definition: strategyFunnelDefinitionSchema,
});

export const createStrategyFunnelSchema = base.extend({ idempotencyKey: z.string().trim().min(8).max(160) }).strict();
export const updateStrategyFunnelSchema = base.extend({ expectedRevision: z.number().int().positive() }).strict();
export const strategyFunnelQuerySchema = z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() }).strict().refine((value) => value.periodEnd > value.periodStart, { message: "O fim do período deve ser posterior ao início." });

export type StrategyFunnelDefinition = z.infer<typeof strategyFunnelDefinitionSchema>;
