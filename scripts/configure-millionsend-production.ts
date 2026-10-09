import "dotenv/config";

import { Prisma } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/shared/core/database/client";

const SELLERS = [
  { email: "jhoncunha@politizai.com", key: "millionsend-jhoncunha" },
  { email: "ederafael@politizai.com", key: "millionsend-ederafael" },
  { email: "carloshenrique@politizai.com", key: "millionsend-carloshenrique" },
] as const;

const execute = process.argv.includes("--execute");
const domainVerified = process.argv.includes("--domain-verified");
const allowProduction = process.argv.includes("--allow-production");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória.");
const hostname = new URL(databaseUrl).hostname;
const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(hostname);
if (!isLocal && !allowProduction) throw new Error("Banco remoto exige --allow-production explícito.");
if (execute && !domainVerified) throw new Error("Aplicação exige confirmação --domain-verified após a MillionSend validar o domínio.");

const database = getDatabaseClient();
try {
  const users = await database.user.findMany({
    where: { normalizedEmail: { in: SELLERS.map((seller) => seller.email) }, status: "ACTIVE", deletedAt: null },
    select: {
      id: true,
      normalizedEmail: true,
      displayName: true,
      memberships: {
        where: { status: "ACTIVE", deletedAt: null, workspace: { status: "ACTIVE", deletedAt: null } },
        select: { id: true, workspaceId: true, workspace: { select: { slug: true } } },
      },
    },
  });
  if (users.length !== SELLERS.length) throw new Error("Nem todos os três vendedores ativos foram encontrados pelos e-mails exatos.");
  const workspaceIds = new Set(users.flatMap((user) => user.memberships.map((membership) => membership.workspaceId)));
  if (workspaceIds.size !== 1) throw new Error("Os três vendedores não pertencem a um único workspace ativo em comum.");
  const workspaceId = [...workspaceIds][0]!;
  const workspaceSlug = users.flatMap((user) => user.memberships).find((membership) => membership.workspaceId === workspaceId)?.workspace.slug;
  const memberIds = users.flatMap((user) => user.memberships).filter((membership) => membership.workspaceId === workspaceId).map((membership) => membership.id);
  const sellerConfigs = await database.prospectingSellerConfig.findMany({
    where: { workspaceId, memberId: { in: memberIds } },
    select: { id: true, memberId: true, senderProfileId: true, active: true, dailyEmailLimit: true },
  });
  const sellers = SELLERS.map((expected) => {
    const user = users.find((candidate) => candidate.normalizedEmail === expected.email);
    const membership = user?.memberships.find((candidate) => candidate.workspaceId === workspaceId);
    const sellerConfig = membership ? sellerConfigs.find((candidate) => candidate.memberId === membership.id) : null;
    if (!user || !membership || !sellerConfig) throw new Error(`Configuração de prospecção ausente para ${expected.email}.`);
    return { ...expected, user, membership, sellerConfig };
  });
  const settings = await database.prospectingSettings.findUnique({
    where: { workspaceId },
    select: { id: true, emailEgressEnabled: true, privacyApprovedAt: true, canaryApprovedAt: true },
  });
  if (!settings) throw new Error("Configuração de prospecção não encontrada.");
  if (settings.emailEgressEnabled) throw new Error("Configuração bloqueada: os envios em massa já estão habilitados.");

  const preview = {
    mode: execute ? "EXECUTE" : "DRY_RUN",
    workspace: workspaceSlug,
    domain: "politizai.com",
    domainVerified,
    emailEgressEnabled: settings.emailEgressEnabled,
    privacyApproved: Boolean(settings.privacyApprovedAt),
    canaryApproved: Boolean(settings.canaryApprovedAt),
    sellers: sellers.map(({ email, key, user, sellerConfig }) => ({
      email,
      key,
      displayName: user.displayName,
      sellerConfigId: sellerConfig.id,
      currentlyActive: sellerConfig.active,
      currentDailyEmailLimit: sellerConfig.dailyEmailLimit,
      currentSenderProfileId: sellerConfig.senderProfileId,
    })),
  };

  if (!execute) {
    process.stdout.write(`${JSON.stringify(preview)}\n`);
  } else {
    const result = await database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`millionsend-configuration:${workspaceId}`}, 0))`;
      const lockedSettings = await transaction.prospectingSettings.findUniqueOrThrow({ where: { workspaceId }, select: { emailEgressEnabled: true } });
      if (lockedSettings.emailEgressEnabled) throw new Error("O egress foi habilitado durante a configuração; nenhuma alteração foi aplicada.");

      const actor = await transaction.actor.findFirst({
        where: { workspaceId, type: { in: ["SYSTEM", "HUMAN"] } },
        orderBy: [{ type: "desc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!actor) throw new Error("Ator de auditoria não encontrado.");

      const configured: Array<{ email: string; connectionId: string; profileId: string; memberId: string }> = [];
      const now = new Date();
      for (const seller of sellers) {
        const connection = await transaction.integrationConnection.upsert({
          where: { workspaceId_key: { workspaceId, key: seller.key } },
          create: {
            workspaceId,
            key: seller.key,
            providerKey: "MILLIONSEND",
            adapterKey: "millionsend-email",
            displayName: `MillionSend — ${seller.user.displayName}`,
            environment: "PRODUCTION",
            status: "CONNECTED",
            capabilityLevel: "PRODUCTION",
            enabled: true,
            lastTestedAt: now,
            lastSucceededAt: now,
            createdByActorId: actor.id,
            updatedByActorId: actor.id,
          },
          update: {
            providerKey: "MILLIONSEND",
            adapterKey: "millionsend-email",
            displayName: `MillionSend — ${seller.user.displayName}`,
            environment: "PRODUCTION",
            status: "CONNECTED",
            capabilityLevel: "PRODUCTION",
            enabled: true,
            lastTestedAt: now,
            lastSucceededAt: now,
            lastErroredAt: null,
            currentErrorClass: null,
            currentErrorCode: null,
            currentErrorMessage: null,
            disabledAt: null,
            updatedByActorId: actor.id,
            revision: { increment: 1 },
          },
          select: { id: true },
        });
        const profile = await transaction.emailConnectionProfile.upsert({
          where: { workspaceId_connectionId: { workspaceId, connectionId: connection.id } },
          create: {
            workspaceId,
            connectionId: connection.id,
            operatingMode: "EXTERNAL_READY",
            adapterVersion: "millionsend/1.0",
            senderAddress: seller.email,
            senderAddressNormalized: seller.email,
            displayName: seller.user.displayName,
            envelopeFrom: seller.email,
            replyTo: seller.email,
            domain: "politizai.com",
            region: "sa-east-1",
            spfStatus: "VERIFIED_EXTERNAL",
            dkimStatus: "VERIFIED_EXTERNAL",
            dmarcStatus: "VERIFIED_EXTERNAL",
            domainStatusProvenance: "MILLIONSEND_DNS_VERIFICATION",
            capabilitySnapshotVersion: "millionsend/1.0",
            configuredAt: now,
            validatedAt: now,
            createdByActorId: actor.id,
            updatedByActorId: actor.id,
          },
          update: {
            operatingMode: "EXTERNAL_READY",
            adapterVersion: "millionsend/1.0",
            senderAddress: seller.email,
            senderAddressNormalized: seller.email,
            displayName: seller.user.displayName,
            envelopeFrom: seller.email,
            replyTo: seller.email,
            domain: "politizai.com",
            region: "sa-east-1",
            spfStatus: "VERIFIED_EXTERNAL",
            dkimStatus: "VERIFIED_EXTERNAL",
            dmarcStatus: "VERIFIED_EXTERNAL",
            domainStatusProvenance: "MILLIONSEND_DNS_VERIFICATION",
            capabilitySnapshotVersion: "millionsend/1.0",
            configuredAt: now,
            validatedAt: now,
            pausedReason: null,
            updatedByActorId: actor.id,
          },
          select: { id: true },
        });
        await transaction.integrationSecretReference.upsert({
          where: { workspaceId_connectionId_alias_version: { workspaceId, connectionId: connection.id, alias: "api-key", version: 1 } },
          create: { workspaceId, connectionId: connection.id, alias: "api-key", referenceKey: "MILLIONSEND_API_KEY", version: 1, present: true, createdByActorId: actor.id },
          update: { referenceKey: "MILLIONSEND_API_KEY", present: true, disabledAt: null },
        });
        await transaction.integrationConnectionCapability.upsert({
          where: { workspaceId_connectionId_capability: { workspaceId, connectionId: connection.id, capability: "SYNC_PUSH" } },
          create: { workspaceId, connectionId: connection.id, capability: "SYNC_PUSH", enabled: true },
          update: { enabled: true },
        });
        await transaction.prospectingSellerConfig.update({
          where: { id: seller.sellerConfig.id },
          data: { senderProfileId: profile.id, updatedByActorId: actor.id },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId,
            actorId: actor.id,
            action: "integration.millionsend.sender_configured",
            entityType: "IntegrationConnection",
            entityId: connection.id,
            origin: "SYSTEM",
            occurredAt: now,
            changes: {
              senderAddress: seller.email,
              replyTo: seller.email,
              domain: "politizai.com",
              region: "sa-east-1",
              domainVerified: true,
              secretValuesStored: false,
              massEmailEgressEnabled: false,
            } satisfies Prisma.InputJsonValue,
          },
        });
        configured.push({ email: seller.email, connectionId: connection.id, profileId: profile.id, memberId: seller.membership.id });
      }
      return configured;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
    process.stdout.write(`${JSON.stringify({ ...preview, configured: result })}\n`);
  }
} finally {
  await database.$disconnect();
}
