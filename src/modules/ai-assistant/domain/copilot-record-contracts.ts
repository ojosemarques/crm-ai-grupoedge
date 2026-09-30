import { z } from "zod";

export const copilotRecordEntities = ["LEAD", "CUSTOMER", "OPPORTUNITY", "TASK", "INVOICE", "SUBSCRIPTION", "EXPENSE", "CONTRACT", "ONBOARDING", "MEETING", "AD_PERFORMANCE", "CATEGORY", "FINANCIAL_ACCOUNT", "CUSTOMER_SUCCESS"] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Data civil inválida.");

export const copilotRecordQuerySchema = z.object({
  entity: z.enum(copilotRecordEntities),
  query: z.string().trim().max(160).default(""),
  id: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(25).default(10),
  from: date.optional(),
  to: date.optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.from) !== Boolean(value.to)) context.addIssue({ code: "custom", path: ["from"], message: "Informe início e fim do intervalo juntos." });
  if (value.from && value.to && value.from > value.to) context.addIssue({ code: "custom", path: ["to"], message: "O fim não pode anteceder o início." });
  if (value.from && value.to) {
    const days = (new Date(`${value.to}T00:00:00Z`).getTime() - new Date(`${value.from}T00:00:00Z`).getTime()) / 86_400_000 + 1;
    const maximum = value.entity === "MEETING" ? 31 : 366;
    if (days > maximum) context.addIssue({ code: "custom", path: ["to"], message: `Consulte até ${maximum} dias por vez.` });
  }
  if (value.entity === "TASK" && !value.leadId) context.addIssue({ code: "custom", path: ["leadId"], message: "Busque o lead primeiro e informe seu ID para consultar tarefas." });
  if (value.leadId && !["TASK", "MEETING"].includes(value.entity)) context.addIssue({ code: "custom", path: ["leadId"], message: "O filtro de lead é suportado por tarefas e agenda." });
  if (value.from && !["LEAD", "OPPORTUNITY", "TASK", "INVOICE", "EXPENSE", "MEETING", "AD_PERFORMANCE"].includes(value.entity)) context.addIssue({ code: "custom", path: ["from"], message: "Esta consulta mostra o cadastro atual e não aceita filtro de período." });
  if (value.id && value.from) context.addIssue({ code: "custom", path: ["id"], message: "Para abrir um registro por ID, retire o filtro de período." });
  if (value.entity === "AD_PERFORMANCE" && value.id) context.addIssue({ code: "custom", path: ["id"], message: "A mídia retorna agrupamentos por dimensão e moeda; filtre pelo nome em query." });
});

export type CopilotRecordQuery = z.infer<typeof copilotRecordQuerySchema>;
export const copilotRecordInputGuide = {
  purpose: "Consulta somente leitura de registros autorizados. Cada resposta traz cobertura, total e nextPage; continue por página ou refine query antes de afirmar ausência.",
  entities: copilotRecordEntities,
  pagination: "page de 1 a 1000, pageSize de 1 a 25; query é texto literal de até 160 caracteres, nunca SQL.",
  task: "TASK exige leadId obtido da busca LEAD. Pesquisa todas as tarefas desse lead, inclusive além dos primeiros100 da tela.",
  period: {
    entities: ["LEAD", "OPPORTUNITY", "TASK", "INVOICE", "EXPENSE", "MEETING", "AD_PERFORMANCE"],
    format: "from e to juntos, YYYY-MM-DD, dias civis inclusivos do timezone do workspace; até366 dias, agenda até31 dias. Sem período: agenda usa semana atual; mídia usa mês até hoje; demais entidades consultam a base atual completa.",
    meaning: "LEAD: entrada; OPPORTUNITY: criação; TASK: prazo; INVOICE: vencimento; EXPENSE: competência, vencimento ou quitação; MEETING: início; AD_PERFORMANCE: período do fato importado.",
  },
  detail: "Use id UUID para abrir registro; não combine id com from/to. TASK mantém leadId obrigatório. AD_PERFORMANCE retorna agrupamentos dimensão/moeda e não aceita id: use query pelo nome.",
  constraints: "leadId só se aplica a TASK/MEETING. CUSTOMER, SUBSCRIPTION, CONTRACT, ONBOARDING, CUSTOMER_SUCCESS, CATEGORY e FINANCIAL_ACCOUNT não aceitam from/to. CUSTOMER_SUCCESS usa o ID do cliente para abrir a carteira e a revisão de pós-venda. Leituras nunca concedem autorização de escrita; ações exigem nova prévia e confirmação.",
} as const;
export type CopilotRecordResult = {
  entity: CopilotRecordQuery["entity"];
  source: { key: string; label: string; href: string };
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
  nextPage: number | null;
  records: Array<{ id: string; label: string; href: string; data: Record<string, unknown> }>;
  coverage: string;
  filters: { query: string; id?: string; leadId?: string; from?: string; to?: string };
};
