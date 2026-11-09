import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { previewLegacyCompensation } from "./legacy-compensation-preview";

export async function applyLegacyCompensation(
  database: PrismaClient,
  manifest: Parameters<typeof previewLegacyCompensation>[1],
  actorId: string,
  expectedFingerprint: string,
) {
  const { workspaceId } = manifest;
  const manifestHash = createHash("sha256").update(JSON.stringify(manifest,
    (_key, value) => typeof value === "bigint" ? value.toString() : value)).digest("hex");
  return database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-compensation:${workspaceId}`}, 0))`;
    const actor = await tx.actor.findFirst({ where: { workspaceId, id: actorId, type: "HUMAN" }, select: { userId: true } });
    const member = actor?.userId ? await tx.workspaceMember.findFirst({
      where: { workspaceId, userId: actor.userId, status: "ACTIVE", deletedAt: null, role: { key: "administrator", deletedAt: null } },
      select: { id: true },
    }) : null;
    if (!member) throw new Error("A aplicação exige ator administrador ativo no workspace.");
    const policy = await tx.commercialCompensationPolicy.findUnique({
      where: { workspaceId_version: { workspaceId, version: manifest.version } },
    });
    if (!policy || policy.effectiveDate.toISOString().slice(0, 10) !== manifest.cutoverOn) {
      throw new Error("A política vigente diverge do corte informado.");
    }

    const audit = await tx.auditLog.findFirst({
      where: { workspaceId, action: "commercial.compensation.legacy_imported", requestId: expectedFingerprint },
      select: { metadata: true },
    });
    if (audit) {
      const metadata = audit.metadata;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || metadata.manifestHash !== manifestHash) {
        throw new Error("A impressão digital já foi usada com outro manifesto.");
      }
      return { created: 0, allocated: 0, replayed: true };
    }
    const preview = await previewLegacyCompensation(tx, manifest);
    if (preview.fingerprint !== expectedFingerprint) throw new Error("A prévia mudou. Confira uma nova impressão digital.");
    let created = 0;
    let allocated = 0;
    for (const { planned, contract, activation, firstReceipt, d0, stages, existing, olderTitles, competenceMonth } of preview.sales) {
      if (existing.length || olderTitles) throw new Error("Já existem títulos desta venda. Encaminhe para conciliação antes de importar.");
      for (const stage of stages) {
        const obligationKey = `legacy:stage:${planned.opportunityId}:${stage.days}`;
        await tx.commercialCompensationObligation.create({ data: {
          workspaceId, obligationKey, policyVersion: policy.version, kind: "LEGACY_STAGE",
          sellerMemberId: planned.sellerMemberId, opportunityId: planned.opportunityId, competenceMonth,
          amountCents: stage.amountCents, basisCents: planned.acvCents,
          status: !stage.balanceCents ? "PAID" : "REVIEW",
          reason: stage.balanceCents ? stage.reason ?? "Aguardando liberação da etapa histórica no Financeiro." : null,
          milestoneOn: stage.milestoneOn ? new Date(stage.milestoneOn) : null,
          dueOn: stage.dueOn ? new Date(stage.dueOn) : null,
          sourceFacts: {
            days: stage.days, contractId: contract.id, contractVersionId: contract.currentVersionId,
            d0: d0?.toISOString() ?? null, activationId: activation?.id ?? null, firstReceiptId: firstReceipt?.id ?? null,
            evidence: planned.evidence, reported: planned.reported?.stages.includes(stage.days) ? planned.reported : null,
          },
        } });
        created++;
        for (const allocation of planned.allocations.filter((item) => item.days === stage.days)) {
          const entry = await tx.financialEntry.findUniqueOrThrow({
            where: { workspaceId_id: { workspaceId, id: allocation.financialEntryId } },
            select: { amountCents: true },
          });
          const assigned = await tx.commercialCompensationAllocation.aggregate({
            where: { workspaceId, financialEntryId: allocation.financialEntryId }, _sum: { amountCents: true },
          });
          if ((assigned._sum.amountCents ?? 0n) + allocation.amountCents > entry.amountCents) {
            throw new Error("A soma das alocações excede a despesa comprovada.");
          }
          await tx.commercialCompensationAllocation.create({ data: {
            workspaceId, obligationKey, financialEntryId: allocation.financialEntryId,
            amountCents: allocation.amountCents, evidence: allocation.evidence, recordedById: actorId,
          } });
          allocated++;
        }
      }
    }
    await tx.auditLog.create({ data: {
      workspaceId, actorId, entityId: workspaceId, entityType: "Workspace",
      action: "commercial.compensation.legacy_imported", requestId: expectedFingerprint, changes: { created, allocated },
      metadata: { manifestHash },
    } });
    return { created, allocated, replayed: false };
  }, { timeout: 30_000 });
}
