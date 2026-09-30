import { describe, expect, it } from "vitest";

import { evaluateGoLiveEvidence, GO_LIVE_GATE_CODES } from "@/modules/readiness/domain/go-live-gate";

const release = {
  commit: "1".repeat(40),
  deploymentId: "dpl_stage19",
  migration: "20260930380000",
  productionUrl: "https://crm.example.com",
};

function manifest(status: "PASS" | "BLOCKED") {
  return {
    schemaVersion: "stage19.go-live.v1",
    release,
    gates: Object.fromEntries(GO_LIVE_GATE_CODES.map((code) => [code, {
      status,
      owner: "Responsável nomeado",
      verifiedAt: "2026-09-30T12:00:00.000Z",
      evidence: [`evidence://${code.toLowerCase()}`],
    }])),
    approvals: {
      business: "Aprovador de negócio",
      security: "Aprovador de segurança",
      privacy: "Aprovador de privacidade",
      operations: "Aprovador de operações",
    },
  };
}

describe("gate de go-live da etapa 19", () => {
  it("emite GO somente quando todos os gates possuem PASS explícito", () => {
    const report = evaluateGoLiveEvidence(manifest("PASS"));
    expect(report.decision).toBe("GO");
    expect(report.results).toHaveLength(GO_LIVE_GATE_CODES.length);
  });

  it("mantém NO_GO quando qualquer gate está bloqueado", () => {
    const evidence = manifest("PASS");
    evidence.gates.LEGAL_DPO!.status = "BLOCKED";
    const report = evaluateGoLiveEvidence(evidence);
    expect(report.decision).toBe("NO_GO");
    expect(report.results).toContainEqual(expect.objectContaining({ code: "LEGAL_DPO", status: "BLOCKED" }));
  });

  it("falha fechado para manifesto incompleto ou inválido", () => {
    expect(evaluateGoLiveEvidence({}).decision).toBe("NO_GO");
    const evidence = manifest("PASS");
    delete evidence.gates.INDEPENDENT_PENTEST;
    expect(evaluateGoLiveEvidence(evidence).decision).toBe("NO_GO");
  });
});
