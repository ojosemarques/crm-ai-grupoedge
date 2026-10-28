type Candidate = Readonly<{
  id: string; pipelineId: string; contactId: string | null; fullName: string;
  normalizedEmail: string | null; jobTitle: string | null; needsIdentityReview: boolean;
  contact?: Readonly<{ quality: string; status: string; deletedAt: Date | null }> | null;
}>;
const comparable = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");

// Candidates have the same phone. A shared point alone never establishes identity.
export function resolveIntakeParticipation<T extends Candidate>(
  candidates: readonly T[],
  input: Readonly<{ pipelineId?: string | undefined; email: string | null; fullName: string; jobTitle?: string | null | undefined }>,
) {
  const consistent = candidates.filter((candidate) => Boolean(input.email && candidate.normalizedEmail === input.email)
    && comparable(candidate.fullName) === comparable(input.fullName)
    && !(input.jobTitle && candidate.jobTitle && comparable(input.jobTitle) !== comparable(candidate.jobTitle)));
  const sameFront = consistent.filter((candidate) => candidate.pipelineId === input.pipelineId);
  const contactIds = new Set(consistent.flatMap((candidate) => candidate.contactId ? [candidate.contactId] : []));
  const unambiguous = consistent.length === candidates.length && contactIds.size === 1;
  const confirmed = unambiguous && consistent.every((candidate) => !candidate.needsIdentityReview
    && candidate.contact?.quality === "CONFIRMED" && candidate.contact.status === "ACTIVE" && candidate.contact.deletedAt === null);
  return {
    existingLead: sameFront.length === 1 && consistent.length === candidates.length && contactIds.size <= 1 ? sameFront[0]! : null,
    confirmedContactId: confirmed ? [...contactIds][0]! : null,
  };
}
