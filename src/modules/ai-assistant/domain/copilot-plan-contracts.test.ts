import { describe, expect, it } from "vitest";

import { copilotPlanConfirmationSchema, copilotPlanSchema } from "./copilot-plan-contracts";

const leadId = "11111111-1111-4111-8111-111111111111";
const task = { kind: "CREATE_TASK", leadId, title: "Retornar contato", dueAt: "2026-10-02T15:00:00Z" };
const update = { kind: "UPDATE_CUSTOMER", accountId: leadId, expectedRevision: 1, changes: { name: "Cliente revisado" } };

describe("contrato de planos operacionais", () => {
  it("aceita somente duas a cinco etapas tipadas sem execução arbitrária", () => {
    expect(copilotPlanSchema.safeParse({ steps: [task, update] }).success).toBe(true);
    for (const steps of [[task], Array.from({ length: 6 }, (_, index) => ({ ...task, title: `Tarefa ${index}` })), [task, { kind: "EXECUTE_SQL", sql: "delete from leads" }]]) {
      expect(copilotPlanSchema.safeParse({ steps }).success).toBe(false);
    }
  });

  it("rejeita dependências em IDs futuros, configurações externas e etapas duplicadas", () => {
    for (const steps of [[task, { ...update, accountId: { fromStep: 1, field: "accountId" } }], [task, { ...update, workspaceId: leadId }], [task, task], [task, update, { ...update, changes: { size: "SMALL" } }]]) {
      expect(copilotPlanSchema.safeParse({ steps }).success).toBe(false);
    }
  });

  it("rejeita alteração de cliente e despesa dependente do cadastro na mesma aprovação", () => {
    const expense = { kind: "CREATE_EXPENSE", categoryId: leadId, financialAccountId: leadId, customerAccountId: leadId, description: "Consultoria", amountCents: "50000", competenceAt: task.dueAt, dueAt: task.dueAt, status: "PLANNED" };
    expect(copilotPlanSchema.safeParse({ steps: [update, expense] }).success).toBe(false);
  });

  it("confirma somente o ID e a revisão da prévia com consentimento explícito", () => {
    expect(copilotPlanConfirmationSchema.safeParse({ proposalId: leadId, expectedRevision: 1, confirmed: true }).success).toBe(true);
    for (const input of [{ proposalId: leadId, expectedRevision: 1 }, { proposalId: leadId, expectedRevision: 1, confirmed: true, steps: [task, update] }]) {
      expect(copilotPlanConfirmationSchema.safeParse(input).success).toBe(false);
    }
  });

  it("impede criar tarefa que seria cancelada por uma etapa posterior de fechamento", () => {
    const sale = { kind: "CLOSE_SALE", payload: { opportunityId: leadId, expectedRevision: 1, sellerMemberId: leadId, templateVersionId: leadId, startsAt: task.dueAt, totalCents: "300", upfrontCents: "0", monthlyCents: "100", durationMonths: 3 } };
    expect(copilotPlanSchema.safeParse({ steps: [{ ...task, opportunityId: leadId }, sale] }).success).toBe(false);
    expect(copilotPlanSchema.safeParse({ steps: [sale, { ...task, opportunityId: leadId }] }).success).toBe(true);
  });
});
