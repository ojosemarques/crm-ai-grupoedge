import { z } from "zod";

const id = z.string().uuid();
const at = z.string().datetime({ offset: true });
const cents = z.string().regex(/^[1-9]\d*$/).refine((value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER), "Valor inválido ou acima do limite permitido.");

export const copilotActionSchema = z.discriminatedUnion("kind", [
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
  if (action.kind !== "CREATE_EXPENSE") return;
  if (action.status === "SETTLED" && (!action.settledAt || !action.paymentConfirmed)) {
    ctx.addIssue({ code: "custom", path: ["paymentConfirmed"], message: "Confirme o pagamento real e informe a data antes de registrar uma despesa paga." });
  }
  if (action.status === "PLANNED" && (action.settledAt || action.paymentConfirmed)) {
    ctx.addIssue({ code: "custom", path: ["settledAt"], message: "Despesa prevista não possui confirmação de pagamento." });
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
  truncated: boolean;
};
