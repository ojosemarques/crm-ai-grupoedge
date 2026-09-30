import type { CatalogItemKind, CatalogRevenueCategory, DeliveryPlanType } from "@/generated/prisma/client";

export type ContractDeliveryLine = Readonly<{
  id: string;
  productKind: CatalogItemKind;
  revenueCategory: CatalogRevenueCategory;
  totalCents: bigint;
}>;

export const deliveryPlanChecklists = {
  LICENSE: [
    ["users", "Usuários e responsáveis confirmados", 24],
    ["access", "Acessos à plataforma provisionados", 48],
    ["adoption", "Primeiro uso e adoção validados", 120],
  ],
  IMPLEMENTATION: [
    ["kickoff", "Kickoff de implantação realizado", 24],
    ["requirements", "Requisitos e escopo confirmados", 48],
    ["configuration", "Configuração e integrações validadas", 120],
    ["go-live", "Entrada em operação aprovada", 240],
  ],
  MANAGED_SERVICE: [
    ["operation-owner", "Responsáveis da operação confirmados", 24],
    ["operating-routine", "Rotina, SLAs e canais acordados", 48],
    ["baseline", "Linha de base e indicadores registrados", 72],
    ["first-review", "Primeira revisão de valor agendada", 168],
  ],
  LAB_PROJECT: [
    ["briefing", "Briefing e hipótese do projeto aprovados", 24],
    ["scope", "Escopo, entregáveis e critérios de aceite definidos", 48],
    ["execution", "Execução do projeto iniciada", 96],
    ["delivery", "Entrega e aprendizados registrados", 240],
  ],
} as const satisfies Record<DeliveryPlanType, readonly (readonly [string, string, number])[]>;

export function resolveDeliveryPlanType(input: Readonly<{
  productKind: CatalogItemKind;
  revenueCategory: CatalogRevenueCategory;
}>): DeliveryPlanType {
  if (input.productKind === "LICENSE" || input.revenueCategory === "SOFTWARE") return "LICENSE";
  if (input.productKind === "IMPLEMENTATION" || input.revenueCategory === "IMPLEMENTATION") return "IMPLEMENTATION";
  if (input.productKind === "RECURRING_SERVICE" || input.revenueCategory === "RECURRING_SERVICE") return "MANAGED_SERVICE";
  return "LAB_PROJECT";
}

export function groupContractLinesIntoDeliveryPlans(lines: readonly ContractDeliveryLine[]) {
  const groups = new Map<DeliveryPlanType, { contractedValueCents: bigint; sourceContractLineIds: string[] }>();
  for (const line of lines) {
    const type = resolveDeliveryPlanType(line);
    const current = groups.get(type) ?? { contractedValueCents: 0n, sourceContractLineIds: [] };
    current.contractedValueCents += line.totalCents;
    current.sourceContractLineIds.push(line.id);
    groups.set(type, current);
  }
  return [...groups.entries()].map(([type, value]) => ({ type, ...value }));
}
