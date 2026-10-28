import { describe, expect, it } from "vitest";
import { resolveIntakeParticipation } from "./intake-participation";
describe("identidade e participação por frente", () => {
  const candidate = { id: "lead-p", pipelineId: "p", contactId: "person", fullName: "Pessoa Exemplo", normalizedEmail: "test@example.test", jobTitle: null, needsIdentityReview: false, contact: { quality: "CONFIRMED", status: "ACTIVE", deletedAt: null } };
  const input = { pipelineId: "a", email: "test@example.test", fullName: "Pessoa Exemplo" };
  it("preserva participação antiga e reutiliza somente contato já confirmado", () => {
    expect(resolveIntakeParticipation([candidate], input)).toEqual({ existingLead: null, confirmedContactId: "person" });
    expect(resolveIntakeParticipation([candidate], { ...input, pipelineId: "p" }).existingLead?.id).toBe("lead-p");
  });
  it("não funde identidade desconhecida, compartilhada ou divergente", () => {
    expect(resolveIntakeParticipation([{ ...candidate, contact: { ...candidate.contact, quality: "UNKNOWN" } }], input).confirmedContactId).toBeNull();
    expect(resolveIntakeParticipation([candidate, { ...candidate, id: "other", contactId: "other-person", fullName: "Outra Pessoa" }], input).confirmedContactId).toBeNull();
    expect(resolveIntakeParticipation([candidate], { ...input, email: null }).confirmedContactId).toBeNull();
    expect(resolveIntakeParticipation([candidate], { ...input, fullName: "Divergente", pipelineId: "p" }).existingLead).toBeNull();
  });
});
