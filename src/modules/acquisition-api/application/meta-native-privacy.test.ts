import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { META_NATIVE_FEEDBACK_PURPOSE, nativeFeedbackPrivacyEvidence } from "./meta-native-privacy";

const now = new Date("2026-10-28T18:00:00Z");
const input = { workspaceId: "workspace", actorId: "actor", contactId: "contact", now };
function fixture() {
  const approved = { status: "ACTIVE", approvedByActorId: "admin", approvedAt: new Date("2026-10-28T17:00:00Z"), validFrom: new Date("2026-10-28T17:00:00Z"), validTo: null as Date | null };
  const basis = { ...approved, basisType: "LEGITIMATE_INTEREST", approvalReference: "controller-policy-v1" };
  const version = { ...approved, id: "version", allowedChannels: ["OTHER"], legalBasis: basis };
  const purpose = { id: "purpose", versions: [version] };
  const contact = { id: "contact", points: [] as { id: string }[], leads: [] as { id: string }[] };
  const tx = {
    processingPurpose: { findFirst: vi.fn().mockResolvedValue(purpose) },
    contact: { findFirst: vi.fn().mockResolvedValue(contact) },
    consentState: { findMany: vi.fn().mockResolvedValue([]) },
    privacyDecision: { create: vi.fn() },
  };
  return { tx, purpose, version, basis, contact, evaluate: () => nativeFeedbackPrivacyEvidence(tx as unknown as Prisma.TransactionClient, input) };
}
describe("privacidade do retorno comercial nativo", () => {
  it("permite a finalidade aprovada sem fabricar consentimento e limita as consultas ao workspace", async () => {
    const f = fixture();
    expect(await f.evaluate()).toEqual({ allowed: true });
    expect(f.tx.processingPurpose.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: input.workspaceId, code: META_NATIVE_FEEDBACK_PURPOSE, active: true } }));
    expect(f.tx.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: input.workspaceId, id: input.contactId, deletedAt: null, status: "ACTIVE" }) }));
    expect(f.tx.privacyDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ outcome: "ALLOW", consentState: "UNKNOWN", mode: "ENFORCED", reasonCodes: expect.not.arrayContaining(["EXPLICIT_CONSENT_GRANTED"]) }) });
  });
  it.each(["DENIED", "REVOKED", "OPTED_OUT", "REVIEW_REQUIRED"])("respeita %s mesmo com base alternativa aprovada", async (state) => {
    const f = fixture();
    f.tx.consentState.findMany.mockResolvedValue([{ purposeId: f.purpose.id, contactPointId: null, state }]);
    expect(await f.evaluate()).toEqual({ allowed: false });
  });
  it.each(["missing-purpose", "draft-purpose", "unapproved-purpose", "future-purpose", "expired-purpose", "wrong-channel", "draft-basis", "unapproved-basis", "future-basis", "expired-basis", "consent-basis", "missing-contact", "point-optout", "lead-optout"])("bloqueia %s", async (scenario) => {
    const f = fixture();
    if (scenario === "missing-purpose") f.tx.processingPurpose.findFirst.mockResolvedValue(null);
    if (scenario === "draft-purpose") f.version.status = "DRAFT";
    if (scenario === "unapproved-purpose") f.version.approvedByActorId = "";
    if (scenario === "future-purpose") f.version.validFrom = new Date(now.getTime() + 1);
    if (scenario === "expired-purpose") f.version.validTo = now;
    if (scenario === "wrong-channel") f.version.allowedChannels = ["PHONE"];
    if (scenario === "draft-basis") f.basis.status = "DRAFT";
    if (scenario === "unapproved-basis") f.basis.approvalReference = "";
    if (scenario === "future-basis") f.basis.validFrom = new Date(now.getTime() + 1);
    if (scenario === "expired-basis") f.basis.validTo = now;
    if (scenario === "consent-basis") f.basis.basisType = "CONSENT";
    if (scenario === "missing-contact") f.tx.contact.findFirst.mockResolvedValue(null);
    if (scenario === "point-optout") f.contact.points.push({ id: "point" });
    if (scenario === "lead-optout") f.contact.leads.push({ id: "lead" });
    expect(await f.evaluate()).toEqual({ allowed: false });
    expect(f.tx.privacyDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ outcome: "DENY" }) });
  });
  it("respeita oposição da finalidade legada e considera o estado mais recente por finalidade/ponto", async () => {
    const f = fixture();
    f.tx.consentState.findMany.mockResolvedValue([{ purposeId: "legacy", contactPointId: null, state: "REVOKED" }]);
    expect(await f.evaluate()).toEqual({ allowed: false });
    f.tx.consentState.findMany.mockResolvedValue([{ purposeId: "legacy", contactPointId: null, state: "GRANTED" }, { purposeId: "legacy", contactPointId: null, state: "REVOKED" }]);
    expect(await f.evaluate()).toEqual({ allowed: true });
  });
});
