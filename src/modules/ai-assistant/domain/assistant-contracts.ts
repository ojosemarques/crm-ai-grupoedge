import { z } from "zod";

export const assistantProposalTypes = ["AGENT", "PIPELINE_MODEL", "AUTOMATION", "CHART"] as const;
export type AssistantProposalType = (typeof assistantProposalTypes)[number];

const periodSchema = z.enum(["TODAY", "YESTERDAY", "WEEK", "MONTH", "CUSTOM"]);

export const assistantCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("QUERY"),
    payload: z.object({
      question: z.string().trim().min(4).max(1_000),
      preset: periodSchema.default("MONTH"),
      fromDate: z.string().date().optional(),
      toDate: z.string().date().optional(),
    }).strict().superRefine((value, context) => {
      if (value.preset === "CUSTOM" && (!value.fromDate || !value.toDate)) {
        context.addIssue({ code: "custom", message: "Período personalizado exige início e fim." });
      }
    }),
  }).strict(),
  z.object({
    action: z.literal("PROPOSE"),
    payload: z.object({
      request: z.string().trim().min(10).max(4_000),
      type: z.enum(assistantProposalTypes).optional(),
    }).strict(),
  }).strict(),
  z.object({
    action: z.literal("CANCEL"),
    payload: z.object({
      proposalId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      reason: z.string().trim().min(3).max(500),
    }).strict(),
  }).strict(),
  z.object({
    action: z.literal("APPROVE"),
    payload: z.object({
      proposalId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      reason: z.string().trim().min(3).max(500),
    }).strict(),
  }).strict(),
  z.object({
    action: z.literal("UNDO"),
    payload: z.object({
      proposalId: z.string().uuid(),
      reason: z.string().trim().min(3).max(500),
    }).strict(),
  }).strict(),
]);

export type AssistantCommand = z.infer<typeof assistantCommandSchema>;

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function inferProposalType(request: string): AssistantProposalType | null {
  const text = normalized(request);
  const matches: AssistantProposalType[] = [];
  if (/agente|assistente|bot/.test(text)) matches.push("AGENT");
  if (/funil|pipeline|modelo de venda|etapa/.test(text)) matches.push("PIPELINE_MODEL");
  if (/automacao|fluxo|gatilho|workflow/.test(text)) matches.push("AUTOMATION");
  if (/grafico|dashboard|painel|visualizacao/.test(text)) matches.push("CHART");
  return matches.length === 1 ? matches[0]! : null;
}

export function inferManagerQuestion(question: string) {
  const text = normalized(question);
  const matches = [
    (/p1|prioridade/.test(text) && /tentativa|contato/.test(text)) ? "P1_WITHOUT_ATTEMPT" : null,
    (/sdr/.test(text) && /media|performance|abaixo/.test(text)) ? "SDRS_BELOW_AVERAGE" : null,
    (/funil|pipeline/.test(text) && /conversao|perda|gargalo/.test(text)) ? "BIGGEST_FUNNEL_LOSS" : null,
    (/reuniao/.test(text) && /amanha|pacto/.test(text)) ? "TOMORROW_MEETINGS_WITHOUT_PACTO" : null,
    (/oportunidade|negocio/.test(text) && /parad|estagn|sem moviment/.test(text)) ? "STALLED_OPPORTUNITIES" : null,
    (/origem|fonte|canal/.test(text) && /reuniao|qualific/.test(text)) ? "TOP_SOURCE_QUALIFIED_MEETINGS" : null,
    (/show.?rate|comparecimento|falt/.test(text)) ? "SHOW_RATE_DROP" : null,
    (/lead/.test(text) && /acao|hoje|pendente/.test(text)) ? "LEADS_REQUIRING_ACTION_TODAY" : null,
  ].filter((value): value is NonNullable<typeof value> => value !== null);
  return matches.length === 1 ? matches[0]! : null;
}
