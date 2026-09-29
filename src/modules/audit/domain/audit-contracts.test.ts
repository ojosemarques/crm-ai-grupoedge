import { describe, expect, it } from "vitest";

import { sanitizeAuditValue } from "@/modules/audit/application/audit-administration-service";
import { processViolationHref, slaViolationSeverity } from "@/modules/audit/domain/audit-contracts";

describe("contratos determinísticos da auditoria", () => {
  it("classifica a severidade sem transformar as faixas em tolerância do SLA zero", () => {
    expect(slaViolationSeverity(1)).toBe("LOW");
    expect(slaViolationSeverity(60)).toBe("LOW");
    expect(slaViolationSeverity(61)).toBe("HIGH");
    expect(slaViolationSeverity(180)).toBe("HIGH");
    expect(slaViolationSeverity(181)).toBe("CRITICAL");
  });

  it("mascara dados sensíveis sem remover os demais fatos", () => {
    expect(sanitizeAuditValue({
      fullName: "Lead fictício",
      normalizedPhone: "+5511999999999",
      email: "teste@exemplo.local",
      nested: { tokenHash: "segredo", status: "OPEN" },
    })).toEqual({
      fullName: "Lead fictício",
      normalizedPhone: "[dado sensível ocultado]",
      email: "[dado sensível ocultado]",
      nested: { tokenHash: "[dado sensível ocultado]", status: "OPEN" },
    });
  });

  it("gera links apenas para registros persistidos relacionados", () => {
    expect(processViolationHref({ leadId: "lead-1", meetingId: null, opportunityId: null })).toBe("/leads/lead-1/historico");
    expect(processViolationHref({ leadId: "lead-1", meetingId: "meeting-1", opportunityId: null })).toBe("/agenda/reunioes/meeting-1");
    expect(processViolationHref({ leadId: null, meetingId: null, opportunityId: "opportunity-1" })).toBe("/oportunidades?opportunityId=opportunity-1");
  });
});
