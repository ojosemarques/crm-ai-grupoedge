import { describe, expect, it } from "vitest";

import { evaluateConsumption } from "./consumption-contracts";

const baseline = {
  status: "ACTIVE" as const,
  limitCents: 1_000n,
  limitUnits: 100n,
  includedCreditCents: 100n,
  creditedCents: 50n,
  spentCents: 900n,
  consumedUnits: 50n,
  requestedAmountCents: 200n,
  requestedUnits: 10n,
  warningBasisPoints: 8_000,
};

describe("governança de consumo", () => {
  it("inclui créditos no saldo e sinaliza a faixa de alerta", () => {
    const result = evaluateConsumption(baseline);
    expect(result).toMatchObject({ allowed: true, code: "ALLOWED", availableCents: 250n, warning: true });
  });

  it("bloqueia e pede pausa somente quando o teto dependente seria excedido", () => {
    const result = evaluateConsumption({ ...baseline, requestedAmountCents: 251n });
    expect(result).toMatchObject({ allowed: false, code: "MONEY_LIMIT_EXCEEDED", shouldPause: true });
  });

  it("mantém revogação distinta de estouro de orçamento", () => {
    const result = evaluateConsumption({ ...baseline, status: "REVOKED" });
    expect(result).toMatchObject({ allowed: false, code: "BUDGET_REVOKED", shouldPause: false });
  });
});
