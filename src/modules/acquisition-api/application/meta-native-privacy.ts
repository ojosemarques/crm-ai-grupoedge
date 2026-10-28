import type { Prisma } from "@/generated/prisma/client";

export const META_NATIVE_FEEDBACK_PURPOSE = "meta-native-commercial-feedback";

// Esta finalidade cobre somente o retorno mínimo de leads nativos já vinculados à Página.
// A autorização administrativa da finalidade não é um consentimento do contato.
export async function nativeFeedbackPrivacyEvidence(tx: Prisma.TransactionClient, input: { workspaceId: string; actorId: string; contactId: string; now: Date }) {
  const purpose = await tx.processingPurpose.findFirst({
    where: { workspaceId: input.workspaceId, code: META_NATIVE_FEEDBACK_PURPOSE, active: true },
    select: { id: true, versions: { orderBy: { version: "desc" }, take: 1, include: { legalBasis: true } } },
  });
  const version = purpose?.versions[0];
  const basis = version?.legalBasis;
  const inWindow = (value: { validFrom: Date | null; validTo: Date | null } | null | undefined) => Boolean(value && (!value.validFrom || value.validFrom <= input.now) && (!value.validTo || value.validTo > input.now));
  const contact = await tx.contact.findFirst({
    where: { workspaceId: input.workspaceId, id: input.contactId, deletedAt: null, status: "ACTIVE" },
    select: {
      id: true,
      points: { where: { deletedAt: null, doNotContact: true }, select: { id: true }, take: 1 },
      leads: { where: { deletedAt: null, contactPreference: "DO_NOT_CONTACT" }, select: { id: true }, take: 1 },
    },
  });
  const states = await tx.consentState.findMany({
    where: { workspaceId: input.workspaceId, contactId: input.contactId, channel: "OTHER", effectiveFrom: { lte: input.now }, purpose: { code: { in: [META_NATIVE_FEEDBACK_PURPOSE, "marketing-conversion-feedback"] } } },
    orderBy: [{ effectiveFrom: "desc" }, { updatedAt: "desc" }],
    select: { purposeId: true, contactPointId: true, state: true },
  });
  const latest = new Map<string, (typeof states)[number]>();
  for (const state of states) {
    const key = `${state.purposeId}:${state.contactPointId ?? "contact"}`;
    if (!latest.has(key)) latest.set(key, state);
  }
  const restricted = [...latest.values()].some((state) => ["DENIED", "REVOKED", "OPTED_OUT", "REVIEW_REQUIRED"].includes(state.state));
  const consentState = states.find((state) => state.purposeId === purpose?.id && !state.contactPointId)?.state ?? "UNKNOWN";
  const reasons = [
    ...(!purpose ? ["PURPOSE_MISSING"] : []),
    ...(version?.status !== "ACTIVE" || !version.approvedByActorId || !version.approvedAt || version.approvedAt > input.now ? ["PURPOSE_NOT_APPROVED"] : []),
    ...(!inWindow(version) ? ["PURPOSE_OUTSIDE_VALIDITY_WINDOW"] : []),
    ...(!version?.allowedChannels.includes("OTHER") ? ["CHANNEL_NOT_ALLOWED"] : []),
    ...(basis?.basisType !== "LEGITIMATE_INTEREST" || basis.status !== "ACTIVE" || !basis.approvalReference || !basis.approvedByActorId || !basis.approvedAt || basis.approvedAt > input.now ? ["NATIVE_LEGAL_BASIS_NOT_APPROVED"] : []),
    ...(!inWindow(basis) ? ["LEGAL_BASIS_OUTSIDE_VALIDITY_WINDOW"] : []),
    ...(!contact ? ["CONTACT_UNAVAILABLE"] : []),
    ...(restricted || contact?.points.length || contact?.leads.length ? ["CONTACT_PRIVACY_RESTRICTION"] : []),
  ];
  const allowed = reasons.length === 0;
  await tx.privacyDecision.create({ data: {
    workspaceId: input.workspaceId, contactId: input.contactId, purposeVersionId: version?.id ?? null,
    channel: "OTHER", intendedAction: "META_NATIVE_CONVERSION_SIGNAL", outcome: allowed ? "ALLOW" : "DENY", mode: "ENFORCED",
    legalBasisStatus: basis?.status ?? null, consentState,
    reasonCodes: allowed ? ["APPROVED_NATIVE_COMMERCIAL_PURPOSE", "APPROVED_LEGITIMATE_INTEREST", "MINIMAL_NATIVE_LEAD_EVENT"] : reasons,
    missingEvidence: reasons, ruleVersion: "meta-native-commercial-feedback-v1", actorId: input.actorId,
  } });
  return { allowed };
}
