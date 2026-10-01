import { z } from "zod";

import { copilotActionSchema, type CopilotActionPreview } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import { saleCompletionSchema } from "@/modules/opportunities/domain/sale-completion-contracts";

export const copilotPlanStepSchema = z.union([
  copilotActionSchema,
  z.object({ kind: z.literal("CLOSE_SALE"), payload: saleCompletionSchema }).strict(),
]);

export const copilotPlanSchema = z.object({
  steps: z.array(copilotPlanStepSchema).min(2).max(5),
}).strict().superRefine((plan, context) => {
  const customerIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const seen = new Set<string>();
  let sales = 0;
  plan.steps.forEach((step, index) => {
    const invalid = (message: string) => context.addIssue({ code: "custom", path: ["steps", index], message });
    const fingerprint = JSON.stringify(step);
    if (seen.has(fingerprint)) invalid("Remova a etapa duplicada antes de confirmar o plano.");
    seen.add(fingerprint);
    if (step.kind === "CLOSE_SALE" && ++sales > 1) invalid("Prepare no máximo um fechamento por plano.");
    if (step.kind === "UPDATE_CUSTOMER") {
      if (customerIds.has(step.accountId)) invalid("Reúna as alterações do mesmo cliente em uma única etapa.");
      customerIds.add(step.accountId);
    }
    if (step.kind === "RECORD_PAYMENT") {
      if (invoiceIds.has(step.invoiceId)) invalid("Prepare somente um recebimento por cobrança em cada plano.");
      invoiceIds.add(step.invoiceId);
    }
  });
  plan.steps.forEach((step, index) => {
    if (step.kind === "CREATE_TASK" && step.opportunityId && plan.steps.slice(index + 1).some((later) => later.kind === "CLOSE_SALE" && later.payload.opportunityId === step.opportunityId)) {
      context.addIssue({ code: "custom", path: ["steps", index], message: "O fechamento cancela tarefas abertas da oportunidade. Coloque a tarefa depois do fechamento." });
    }
    if ((step.kind === "CREATE_EXPENSE" || step.kind === "CREATE_INCOME") && step.customerAccountId && customerIds.has(step.customerAccountId)) {
      context.addIssue({ code: "custom", path: ["steps", index], message: "Atualize o cliente primeiro e prepare a despesa em uma nova prévia com o cadastro atualizado." });
    }
    if (step.kind === "CLOSE_SALE" && step.payload.customer?.mode === "LINK" && customerIds.has(step.payload.customer.accountId)) {
      context.addIssue({ code: "custom", path: ["steps", index], message: "Atualize o cliente primeiro e prepare o fechamento em uma nova prévia." });
    }
  });
});

export type CopilotPlan = z.infer<typeof copilotPlanSchema>;
export type CopilotPlanStep = z.infer<typeof copilotPlanStepSchema>;
export type CopilotPlanPreview = {
  kind: "ACTION_PLAN";
  title: string;
  summary: string;
  atomic: true;
  steps: Array<{ position: number; kind: CopilotPlanStep["kind"]; preview: CopilotActionPreview | Record<string, unknown> }>;
  impact: string[];
};

export const copilotPlanDecisionSchema = z.object({ proposalId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
export const copilotPlanConfirmationSchema = copilotPlanDecisionSchema.extend({ confirmed: z.literal(true) });
