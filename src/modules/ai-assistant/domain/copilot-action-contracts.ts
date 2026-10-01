import { z } from "zod";

const id = z.string().uuid();
const at = z.string().datetime({ offset: true });
const cents = z.string().regex(/^[1-9]\d*$/).refine((value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER), "Valor inválido ou acima do limite permitido.");

export const copilotActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CREATE_LEAD"), pipelineId: id, fullName: z.string().trim().min(2).max(200), phone: z.string().trim().min(1).max(80), email: z.string().email().max(320).optional(), organizationName: z.string().trim().min(2).max(200).optional(), jobTitle: z.string().trim().max(160).optional(), city: z.string().trim().max(120).optional(), stateCode: z.string().length(2).optional(), interestSummary: z.string().trim().max(2000).optional(), sourceKey: z.string().trim().min(1).max(120).default("manual"), priorityBandCode: z.enum(["P1","P2","P3"]).default("P2"), budgetBrl: z.string().max(40).optional() }).strict(),
  z.object({ kind: z.literal("MOVE_LEAD"), leadId: id, targetStageId: id, expectedUpdatedAt: at, reason: z.string().trim().min(3).max(1000) }).strict(),
  z.object({ kind: z.literal("CREATE_CUSTOMER"), name: z.string().trim().min(2).max(200), legalName: z.string().trim().max(240).optional(), domain: z.string().trim().max(253).optional(), segment: z.enum(["PUBLIC_SECTOR","POLITICAL","PRIVATE_SECTOR","NONPROFIT","OTHER","UNKNOWN"]).default("UNKNOWN"), size: z.enum(["SOLO","SMALL","MEDIUM","LARGE","ENTERPRISE","UNKNOWN"]).default("UNKNOWN") }).strict(),
  z.object({ kind: z.literal("CREATE_INCOME"), categoryId: id, financialAccountId: id, customerAccountId: id.optional(), description: z.string().trim().min(3).max(240), counterparty: z.string().trim().min(2).max(160).optional(), amountCents: cents, competenceAt: at, dueAt: at, status: z.enum(["PLANNED","SETTLED"]), settledAt: at.optional(), paymentConfirmed: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal("CREATE_INDICATOR"), name: z.string().trim().min(2).max(120), metricKey: z.string().min(3).max(100), dateBasis: z.string().min(1).max(200), period: z.enum(["TODAY","YESTERDAY","WEEK","MONTH"]) }).strict(),
  z.object({
    kind: z.literal("CREATE_TASK"), leadId: id, opportunityId: id.optional(),
    title: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).optional(),
    taskKind: z.enum(["GENERAL", "CALL", "MESSAGE", "EMAIL", "MEETING", "FOLLOW_UP"]).default("GENERAL"),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"), dueAt: at,
  }).strict(),
  z.object({
    kind: z.literal("UPDATE_CUSTOMER"), accountId: id, expectedRevision: z.number().int().positive(),
    changes: z.object({
      name: z.string().trim().min(2).max(200).optional(),
      legalName: z.string().trim().max(240).nullable().optional(),
      domain: z.string().trim().max(253).nullable().optional(),
      segment: z.enum(["PUBLIC_SECTOR", "POLITICAL", "PRIVATE_SECTOR", "NONPROFIT", "OTHER", "UNKNOWN"]).optional(),
      size: z.enum(["SOLO", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE", "UNKNOWN"]).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo para alterar."),
  }).strict(),
  z.object({
    kind: z.literal("CREATE_EXPENSE"), categoryId: id, financialAccountId: id, customerAccountId: id.optional(),
    description: z.string().trim().min(3).max(240), counterparty: z.string().trim().min(2).max(160).optional(),
    amountCents: cents, competenceAt: at, dueAt: at,
    status: z.enum(["PLANNED", "SETTLED"]), settledAt: at.optional(), paymentConfirmed: z.literal(true).optional(),
  }).strict(),
  z.object({
    kind: z.literal("RECORD_PAYMENT"), invoiceId: id, expectedRevision: z.number().int().positive(),
    financialAccountId: id, amountCents: cents, receivedAt: at,
    method: z.enum(["PIX", "BANK_TRANSFER", "CARD", "CASH", "OTHER"]),
    reference: z.string().trim().min(3).max(180), receiptConfirmed: z.literal(true),
  }).strict(),
]).superRefine((action, ctx) => {
  if (action.kind !== "CREATE_EXPENSE" && action.kind !== "CREATE_INCOME") return;
  if (action.status === "SETTLED" && (!action.settledAt || !action.paymentConfirmed)) {
    ctx.addIssue({ code: "custom", path: ["paymentConfirmed"], message: "Confirme o pagamento real e informe a data antes de registrar um lançamento realizado." });
  }
  if (action.status === "PLANNED" && (action.settledAt || action.paymentConfirmed)) {
    ctx.addIssue({ code: "custom", path: ["settledAt"], message: "Lançamento previsto não possui confirmação de pagamento." });
  }
});

export type CopilotAction = z.infer<typeof copilotActionSchema>;
export type CopilotActionPreview = {
  kind: CopilotAction["kind"]; title: string; summary: string;
  details: Array<{ label: string; before?: string; after: string }>;
  impact: string[]; links?: Array<{ label: string; href: string; entityType: string }>;
  bindings?: Record<string, string | null>;
};
export type CopilotActionOptions = {
  capabilities: CopilotAction["kind"][];
  leads: Array<{ id: string; name: string }>;
  customers: Array<{ id: string; name: string; revision: number; legalName: string | null; domain: string | null; segment: string; size: string }>;
  categories: Array<{ id: string; name: string }>;
  financialAccounts: Array<{ id: string; name: string }>;
  invoices: Array<{ id: string; label: string; revision: number; outstandingCents: string }>;
  pipelines?: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  leadSources?: Array<{ key: string; name: string }>;
  moveLeads?: Array<{ id: string; name: string; pipelineId: string; stageId: string; updatedAt: string }>;
  incomeCategories?: Array<{ id: string; name: string }>;
  metrics?: Array<{ id: string; name: string; dateBases: readonly string[] }>;
  truncated: boolean;
};
