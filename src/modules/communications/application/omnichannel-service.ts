import { createHash, randomUUID } from "node:crypto";

import { Prisma, type MessageStatus, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  channelCapabilities,
  channelPrivacyChannel,
  composeMessageSchema,
  conversationCommandSchema,
  conversationSlaState,
  deliveryScenarioSchema,
  inboxQuerySchema,
  localInboundSchema,
  normalizeChannelAddress,
  OMNICHANNEL_CONTRACT_VERSION,
  shouldProjectMessageStatus,
  templateInputSchema,
  type SupportedConversationChannel,
} from "@/modules/communications/domain/omnichannel-contracts";
import { evaluateWhatsAppOutboundPolicy, WHATSAPP_LOCAL_PROVIDER_KEY } from "@/modules/integrations/domain/whatsapp-contracts";
import { createStableMessageId, EMAIL_PROVIDER_KEY, normalizeMessageId, normalizeReferenceChain } from "@/modules/integrations/domain/email-contracts";
import { cancelPendingOutboundForContactInTransaction, evaluatePrivacyInTransaction } from "@/modules/privacy/application/privacy-service";
import type { ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Tx = Prisma.TransactionClient;
type Authorization = ReturnType<typeof getAuthorizationService>;
type PrivacyEvaluator = typeof evaluatePrivacyInTransaction;
type Options = Readonly<{
  database: PrismaClient;
  authorization: Authorization;
  now: () => Date;
  evaluatePrivacy?: PrivacyEvaluator;
}>;

const MESSAGE_JOB_MAX_ATTEMPTS = 5;
const RETRY_DELAY_SECONDS = 30;
const SERIALIZABLE_MAX_ATTEMPTS = 4;

function fail(message: string, code: string, statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

async function withSerializableRetry<T>(database: PrismaClient, operation: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === SERIALIZABLE_MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("Limite de tentativas serializáveis atingido.");
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(",")).filter(Boolean);
  return typeof value === "string" ? value.split(",").filter(Boolean) : [];
}

function parseInboxQuery(raw: unknown) {
  const candidate = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  return inboxQuerySchema.parse({
    ...candidate,
    channels: splitList(candidate.channels),
    priorities: splitList(candidate.priorities),
  });
}

function conversationResource(row: Readonly<{ workspaceId: string; id: string; assigneeMemberId: string | null; queueId: string | null; queue?: { teamId: string | null } | null }>): ResourceScope {
  return {
    workspaceId: row.workspaceId,
    resourceType: "Conversation",
    resourceId: row.id,
    ownerMemberId: row.assigneeMemberId,
    queueId: row.queueId,
    teamId: row.queue?.teamId ?? null,
  };
}

async function nextStatusSequence(tx: Tx, workspaceId: string, messageId: string): Promise<number> {
  return (await tx.messageStatusEvent.count({ where: { workspaceId, messageId } })) + 1;
}

async function appendStatus(
  tx: Tx,
  input: Readonly<{
    workspaceId: string;
    messageId: string;
    status: MessageStatus;
    source: "INTERNAL" | "LOCAL_SIMULATOR" | "PROVIDER" | "HUMAN_CORRECTION" | "BACKFILL";
    actorId?: string | null;
    externalEventId?: string | null;
    providerOccurredAt?: Date | null;
    reasonCode?: string | null;
    providerReported?: boolean;
    now: Date;
  }>,
) {
  if (input.externalEventId) {
    const existing = await tx.messageStatusEvent.findFirst({
      where: { workspaceId: input.workspaceId, providerKey: "LOCAL_SIMULATOR", externalEventId: input.externalEventId },
    });
    if (existing) return { event: existing, idempotent: true, projected: false };
  }
  const message = await tx.message.findFirst({ where: { id: input.messageId, workspaceId: input.workspaceId } });
  if (!message) fail("Mensagem não encontrada.", "MESSAGE_NOT_FOUND", 404);
  const event = await tx.messageStatusEvent.create({
    data: {
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      status: input.status,
      sequence: await nextStatusSequence(tx, input.workspaceId, input.messageId),
      source: input.source,
      actorId: input.actorId ?? null,
      providerKey: input.source === "LOCAL_SIMULATOR" ? "LOCAL_SIMULATOR" : null,
      externalEventId: input.externalEventId ?? null,
      providerOccurredAt: input.providerOccurredAt ?? null,
      providerReported: input.providerReported ?? false,
      reasonCode: input.reasonCode ?? null,
      ingestedAt: input.now,
    },
  });
  const projected = shouldProjectMessageStatus(message.status, input.status);
  if (projected) {
    await tx.message.update({
      where: { id: message.id },
      data: {
        status: input.status,
        revision: { increment: 1 },
        ...(input.status === "SENT" ? { sentAt: input.now } : {}),
        ...(input.status === "PROVIDER_ACCEPTED" ? { providerAcceptedAt: input.now } : {}),
        ...(input.status === "DELIVERED" ? { deliveredAt: input.now } : {}),
        ...(input.status === "READ" ? { readAt: input.now } : {}),
        ...(input.providerReported ? { lastProviderStatusAt: input.providerOccurredAt ?? input.now } : {}),
      },
    });
  }
  return { event, idempotent: false, projected };
}

async function localFoundation(tx: Tx, workspaceId: string, channel?: SupportedConversationChannel) {
  const connectionKey = channel === "EMAIL" ? "email-local-sink" : channel === "WHATSAPP" ? "whatsapp-cloud-api" : "local-mock";
  const [actor, queue, connection] = await Promise.all([
    tx.actor.findFirst({ where: { workspaceId, type: "SYSTEM" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.queue.findFirst({ where: { workspaceId, isGeneral: true, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.integrationConnection.findFirst({ where: { workspaceId, key: connectionKey, environment: "LOCAL" } }),
  ]);
  if (!actor) fail("Ator Sistema não configurado.", "SYSTEM_ACTOR_MISSING", 409);
  if (!queue) fail("Fila Geral não configurada.", "GENERAL_QUEUE_MISSING", 409);
  if (!connection) fail("Conexão local determinística não configurada.", "LOCAL_CONNECTION_MISSING", 409);
  return { actor, queue, connection };
}

async function getScopedWhere(options: Options, context: AuthenticatedContext): Promise<Prisma.ConversationWhereInput> {
  const probe = await options.authorization.authorize(context, PermissionKeys.INBOX_READ, {
    workspaceId: context.workspaceId,
    resourceType: "Conversation",
    ownerMemberId: context.memberId,
  });
  if (!probe.allowed) await options.authorization.assertAuthorized(context, PermissionKeys.INBOX_READ, { workspaceId: context.workspaceId, resourceType: "Conversation", ownerMemberId: context.memberId });
  if (!probe.allowed || probe.scope === "OWN") return { assigneeMemberId: context.memberId };
  if (probe.scope === "WORKSPACE") return {};
  const teamIds = (await options.database.teamMember.findMany({
    where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null },
    select: { teamId: true },
  })).map((item) => item.teamId);
  return {
    OR: [
      { assignee: { teamMemberships: { some: { workspaceId: context.workspaceId, teamId: { in: teamIds }, deletedAt: null } } } },
      { queue: { teamId: { in: teamIds } } },
    ],
  };
}

async function loadConversation(options: Options, context: AuthenticatedContext, conversationId: string, permission: typeof PermissionKeys.INBOX_READ | typeof PermissionKeys.MESSAGES_COMPOSE | typeof PermissionKeys.MESSAGES_SEND | typeof PermissionKeys.MESSAGES_REPLAY | typeof PermissionKeys.CONVERSATIONS_ASSIGN | typeof PermissionKeys.CONVERSATIONS_MANAGE) {
  const row = await options.database.conversation.findFirst({
    where: { id: conversationId, workspaceId: context.workspaceId, deletedAt: null },
    include: { queue: { select: { id: true, name: true, teamId: true } } },
  });
  if (!row) fail("Conversa não encontrada neste workspace.", "CONVERSATION_NOT_FOUND", 404);
  await options.authorization.assertAuthorized(context, permission, conversationResource(row));
  return row;
}

export function createOmnichannelService(options: Options) {
  const evaluatePrivacy = options.evaluatePrivacy ?? evaluatePrivacyInTransaction;

  async function getInbox(context: AuthenticatedContext, raw: unknown) {
    const query = parseInboxQuery(raw);
    const scoped = await getScopedWhere(options, context);
    const now = options.now();
    const where: Prisma.ConversationWhereInput = {
      workspaceId: context.workspaceId,
      deletedAt: null,
      ...scoped,
      ...(query.conversationId ? { id: query.conversationId } : {}),
      ...(query.channels.length ? { channel: { in: query.channels } } : {}),
      ...(query.priorities.length ? { priority: { in: query.priorities } } : {}),
      ...(query.cursor ? { lastMessageAt: { lt: new Date(query.cursor) } } : {}),
      ...(query.view === "MINE" ? { assigneeMemberId: context.memberId } : {}),
      ...(query.view === "UNREAD" ? { unreadCount: { gt: 0 } } : {}),
      ...(query.view === "OVERDUE" ? { status: "PENDING_INTERNAL", waitingSince: { lt: new Date(now.getTime() - 180_000) } } : {}),
      ...(query.view === "WAITING_INTERNAL" ? { status: "PENDING_INTERNAL" } : {}),
      ...(query.view === "WAITING_CUSTOMER" ? { status: "WAITING_CUSTOMER" } : {}),
      ...(query.search ? {
        OR: [
          { subject: { contains: query.search, mode: "insensitive" } },
          { lead: { fullName: { contains: query.search, mode: "insensitive" } } },
          { contact: { preferredName: { contains: query.search, mode: "insensitive" } } },
          { account: { name: { contains: query.search, mode: "insensitive" } } },
        ],
      } : {}),
    };
    const [rows, counts, canCompose, canAssign, canManage, canReplay, canViewSensitive, members, queues, templates, metrics] = await Promise.all([
      options.database.conversation.findMany({
        where,
        orderBy: [{ priority: "desc" }, { unreadCount: "desc" }, { lastMessageAt: "desc" }, { id: "desc" }],
        take: query.take + 1,
        include: {
          lead: { select: { id: true, fullName: true, jobTitle: true, ownerMemberId: true, queueId: true } },
          contact: { select: { id: true, preferredName: true, legalName: true } },
          account: { select: { id: true, name: true } },
          assignee: { select: { id: true, user: { select: { displayName: true } } } },
          queue: { select: { id: true, name: true, teamId: true } },
          messages: { where: { deletedAt: null }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, body: true, direction: true, status: true, occurredAt: true, isSimulated: true, redactedAt: true } },
          identityReviews: { where: { status: "OPEN" }, select: { id: true }, take: 1 },
        },
      }),
      options.database.conversation.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId, deletedAt: null, ...scoped }, _count: { _all: true } }),
      options.authorization.authorize(context, PermissionKeys.MESSAGES_COMPOSE, { workspaceId: context.workspaceId, resourceType: "Conversation", ownerMemberId: context.memberId }),
      options.authorization.authorize(context, PermissionKeys.CONVERSATIONS_ASSIGN, { workspaceId: context.workspaceId, resourceType: "Conversation", ownerMemberId: context.memberId }),
      options.authorization.authorize(context, PermissionKeys.CONVERSATIONS_MANAGE, { workspaceId: context.workspaceId, resourceType: "Conversation", ownerMemberId: context.memberId }),
      options.authorization.authorize(context, PermissionKeys.MESSAGES_REPLAY, { workspaceId: context.workspaceId, resourceType: "Conversation", ownerMemberId: context.memberId }),
      options.authorization.authorize(context, PermissionKeys.MESSAGES_VIEW_SENSITIVE, { workspaceId: context.workspaceId, resourceType: "Conversation", ownerMemberId: context.memberId }),
      options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, orderBy: { user: { displayName: "asc" } }, select: { id: true, user: { select: { displayName: true } } } }),
      options.database.queue.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      options.database.messageTemplate.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE_LOCAL" }, orderBy: { name: "asc" }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }),
      getMetrics(context),
    ]);
    const hasMore = rows.length > query.take;
    const visible = rows.slice(0, query.take).map((row) => ({
      id: row.id,
      channel: row.channel,
      status: row.status,
      subject: row.subject,
      priority: row.priority,
      unreadCount: row.unreadCount,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      waitingSince: row.waitingSince?.toISOString() ?? null,
      sla: conversationSlaState({ status: row.status, waitingSince: row.waitingSince, now }),
      revision: row.revision,
      lead: row.lead,
      contactName: row.contact?.preferredName ?? row.contact?.legalName ?? row.lead?.fullName ?? "Contato não identificado",
      account: row.account,
      assignee: row.assignee ? { id: row.assignee.id, name: row.assignee.user.displayName } : null,
      queue: row.queue ? { id: row.queue.id, name: row.queue.name } : null,
      needsIdentityReview: row.identityReviews.length > 0,
      preview: row.messages[0] ? { ...row.messages[0], body: canViewSensitive.allowed ? row.messages[0].body : row.messages[0].body ? "Conteúdo protegido" : null, occurredAt: row.messages[0].occurredAt.toISOString() } : null,
    }));
    const selectedId = query.conversationId ?? visible[0]?.id ?? null;
    const detail = selectedId ? await getConversation(context, selectedId) : null;
    return {
      generatedAt: now.toISOString(),
      timeZone: "America/Sao_Paulo",
      capabilityMatrix: channelCapabilities,
      query,
      counts,
      metrics,
      conversations: visible,
      selected: detail,
      pagination: { hasMore, nextCursor: hasMore ? visible.at(-1)?.lastMessageAt ?? null : null },
      options: { members: members.map((item) => ({ id: item.id, name: item.user.displayName })), queues, templates: templates.map((item) => ({ id: item.id, name: item.name, channel: item.channel, version: item.versions[0] ? { id: item.versions[0].id, version: item.versions[0].version, bodyTemplate: item.versions[0].bodyTemplate, variables: item.versions[0].variables } : null })) },
      capabilities: { compose: canCompose.allowed, assign: canAssign.allowed, manage: canManage.allowed, replay: canReplay.allowed, viewSensitive: canViewSensitive.allowed },
    };
  }

  async function getConversation(context: AuthenticatedContext, conversationId: string) {
    const row = await loadConversation(options, context, conversationId, PermissionKeys.INBOX_READ);
    const sensitive = await options.authorization.authorize(context, PermissionKeys.MESSAGES_VIEW_SENSITIVE, conversationResource(row));
    const [messages, assignments, participants] = await Promise.all([
      options.database.message.findMany({
        where: { workspaceId: context.workspaceId, conversationId, deletedAt: null },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: 200,
        include: { statusEvents: { orderBy: { sequence: "asc" } }, attachments: true, emailProfile: { include: { recipients: true } } },
      }),
      options.database.conversationAssignmentHistory.findMany({ where: { workspaceId: context.workspaceId, conversationId }, orderBy: { occurredAt: "asc" }, include: { previousOwner: { select: { user: { select: { displayName: true } } } }, newOwner: { select: { user: { select: { displayName: true } } } }, previousQueue: { select: { name: true } }, newQueue: { select: { name: true } } } }),
      options.database.conversationParticipant.findMany({ where: { workspaceId: context.workspaceId, conversationId }, orderBy: { createdAt: "asc" } }),
    ]);
    return {
      id: row.id,
      channel: row.channel,
      status: row.status,
      subject: row.subject,
      priority: row.priority,
      unreadCount: row.unreadCount,
      revision: row.revision,
      leadId: row.leadId,
      accountId: row.accountId,
      assigneeMemberId: row.assigneeMemberId,
      queueId: row.queueId,
      queue: row.queue,
      openedAt: row.openedAt.toISOString(),
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      waitingSince: row.waitingSince?.toISOString() ?? null,
      firstInboundAt: row.firstInboundAt?.toISOString() ?? null,
      lastCustomerInboundAt: row.lastCustomerInboundAt?.toISOString() ?? null,
      serviceWindowExpiresAt: row.serviceWindowExpiresAt?.toISOString() ?? null,
      firstHumanResponseAt: row.firstHumanResponseAt?.toISOString() ?? null,
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        type: message.type,
        status: message.status,
        subject: message.subject,
        body: sensitive.allowed ? message.body : message.body ? "Conteúdo protegido" : null,
        isSimulated: message.isSimulated,
        simulationLabel: message.simulationLabel,
        occurredAt: message.occurredAt.toISOString(),
        sentAt: message.sentAt?.toISOString() ?? null,
        receivedAt: message.receivedAt?.toISOString() ?? null,
        providerAcceptedAt: message.providerAcceptedAt?.toISOString() ?? null,
        deliveredAt: message.deliveredAt?.toISOString() ?? null,
        readAt: message.readAt?.toISOString() ?? null,
        lastProviderStatusAt: message.lastProviderStatusAt?.toISOString() ?? null,
        redactedAt: message.redactedAt?.toISOString() ?? null,
        email: message.emailProfile ? { messageId: message.emailProfile.messageIdHeader, inReplyTo: message.emailProfile.inReplyToHeader, references: message.emailProfile.referencesHeaders, recipients: message.emailProfile.recipients.map((recipient) => ({ type: recipient.type, address: recipient.maskedAddress })) } : null,
        statusEvents: message.statusEvents.map((event) => ({ ...event, providerOccurredAt: event.providerOccurredAt?.toISOString() ?? null, ingestedAt: event.ingestedAt.toISOString(), createdAt: event.createdAt.toISOString() })),
        attachments: message.attachments.map((attachment) => ({ id: attachment.id, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, scanStatus: attachment.scanStatus, createdAt: attachment.createdAt.toISOString() })),
      })),
      assignments: assignments.map((item) => ({ id: item.id, reason: item.reason, occurredAt: item.occurredAt.toISOString(), previous: item.previousOwner?.user.displayName ?? item.previousQueue?.name ?? null, next: item.newOwner?.user.displayName ?? item.newQueue?.name ?? null })),
      participants: participants.map((participant) => ({ id: participant.id, role: participant.role, externalAddressMasked: participant.externalAddressMasked, activeFrom: participant.activeFrom.toISOString(), activeUntil: participant.activeUntil?.toISOString() ?? null })),
    };
  }

  async function receiveLocal(context: AuthenticatedContext, raw: unknown) {
    await options.authorization.assertAuthorized(context, PermissionKeys.MESSAGES_REPLAY, { workspaceId: context.workspaceId, resourceType: "Conversation", ownerMemberId: context.memberId });
    const input = localInboundSchema.parse(raw);
    const normalized = normalizeChannelAddress(input.channel, input.address);
    const now = options.now();
    return withSerializableRetry(options.database, async (tx) => {
      const foundation = await localFoundation(tx, context.workspaceId, input.channel);
      const threadIdentity = normalized.success ? normalized.hash : sha256(input.address.trim().toLowerCase());
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`omnichannel-inbound:${context.workspaceId}:${input.channel}:${threadIdentity}`}, 0))`;
      const existing = await tx.webhookInbox.findUnique({ where: { workspaceId_connectionId_providerEventId: { workspaceId: context.workspaceId, connectionId: foundation.connection.id, providerEventId: input.externalEventId } }, include: { message: true } });
      if (existing) return { outcome: "IDEMPOTENT" as const, webhookId: existing.id, messageId: existing.messageId, conversationId: existing.message?.conversationId ?? null };
      const points = normalized.success ? await tx.contactPoint.findMany({ where: { workspaceId: context.workspaceId, normalizedValue: normalized.normalized, type: input.channel === "EMAIL" ? "EMAIL" : "PHONE", deletedAt: null }, take: 3, include: { contact: { include: { leads: { where: { deletedAt: null }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 2 } } } } }) : [];
      const exact = points.length === 1 ? points[0] : null;
      const lead = exact?.contact.leads[0] ?? null;
      const ownerMemberId = lead?.ownerMemberId ?? null;
      const queueId = ownerMemberId ? null : lead?.queueId ?? foundation.queue.id;
      const referencedEmail = input.channel === "EMAIL" && input.inReplyToHeader
        ? await tx.emailMessageProfile.findFirst({ where: { workspaceId: context.workspaceId, messageIdHeader: normalizeMessageId(input.inReplyToHeader) }, include: { message: { include: { conversation: true } } } })
        : null;
      let conversation = referencedEmail?.message.conversation && !["CLOSED", "ARCHIVED"].includes(referencedEmail.message.conversation.status)
        ? referencedEmail.message.conversation
        : exact && !(input.channel === "EMAIL" && input.inReplyToHeader)
          ? await tx.conversation.findFirst({ where: { workspaceId: context.workspaceId, contactPointId: exact.id, channel: input.channel, status: { notIn: ["CLOSED", "ARCHIVED"] }, deletedAt: null }, orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }] })
          : null;
      const createdNew = !conversation;
      conversation ??= await tx.conversation.create({
        data: {
          workspaceId: context.workspaceId,
          contactId: exact?.contactId ?? null,
          contactPointId: exact?.id ?? null,
          accountId: lead?.accountId ?? null,
          leadId: lead?.id ?? null,
          connectionId: foundation.connection.id,
          assigneeMemberId: ownerMemberId,
          queueId,
          channel: input.channel,
          status: "PENDING_INTERNAL",
          subject: input.subject ?? null,
          priority: lead?.priority ?? "MEDIUM",
          externalThreadId: `local:${normalized.success ? normalized.hash : sha256(input.address)}`,
          firstInboundAt: new Date(input.occurredAt),
          waitingSince: new Date(input.occurredAt),
          openedAt: new Date(input.occurredAt),
          createdByActorId: foundation.actor.id,
          updatedByActorId: foundation.actor.id,
        },
      });
      let participant = await tx.conversationParticipant.findFirst({ where: { workspaceId: context.workspaceId, conversationId: conversation.id, identifierKey: normalized.success ? normalized.hash : sha256(input.address), activeUntil: null } });
      participant ??= await tx.conversationParticipant.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, role: exact ? "CONTACT" : "UNKNOWN_EXTERNAL", contactId: exact?.contactId ?? null, contactPointId: exact?.id ?? null, identifierKey: normalized.success ? normalized.hash : sha256(input.address), externalAddressMasked: normalized.success ? normalized.masked : "endereço inválido" } });
      const message = await tx.message.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, senderActorId: foundation.actor.id, senderParticipantId: participant.id, direction: "INBOUND", type: "TEXT", status: "RECEIVED", subject: input.subject ?? null, body: input.body, bodyHash: sha256(input.body), providerKey: "LOCAL_SIMULATOR", externalMessageId: input.externalEventId, idempotencyKey: `inbound:${input.externalEventId}`, clientCorrelationId: input.externalEventId, isSimulated: true, simulationLabel: "Evento recebido apenas pelo simulador local; nenhum provider externo foi acionado.", occurredAt: new Date(input.occurredAt), receivedAt: now } });
      if (input.channel === "EMAIL") {
        const profile = await tx.emailConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId, connectionId: foundation.connection.id } });
        if (!profile) fail("Perfil local de e-mail não configurado.", "EMAIL_PROFILE_MISSING", 409);
        const header = input.messageIdHeader ? normalizeMessageId(input.messageIdHeader) : createStableMessageId(context.workspaceId, message.id, profile.domain);
        const emailMessage = await tx.emailMessageProfile.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, messageId: message.id, messageIdHeader: header, inReplyToHeader: input.inReplyToHeader ? normalizeMessageId(input.inReplyToHeader) : null, referencesHeaders: normalizeReferenceChain(input.referenceHeaders), textBodyHash: message.bodyHash! } });
        await tx.emailRecipient.create({ data: { workspaceId: context.workspaceId, emailMessageId: emailMessage.id, type: "TO", normalizedAddress: profile.senderAddressNormalized, maskedAddress: profile.senderAddressNormalized.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2") } });
        if (input.inReplyToHeader && !referencedEmail) await tx.emailEventReview.create({ data: { workspaceId: context.workspaceId, profileId: profile.id, emailMessageId: emailMessage.id, messageId: message.id, eventKey: input.externalEventId, reasonCode: "THREAD_NOT_FOUND", evidence: json({ subjectIgnoredForThreading: true, referenceCount: input.referenceHeaders.length }), createdByActorId: foundation.actor.id } });
      }
      await appendStatus(tx, { workspaceId: context.workspaceId, messageId: message.id, status: "RECEIVED", source: "LOCAL_SIMULATOR", actorId: foundation.actor.id, externalEventId: input.externalEventId, providerOccurredAt: new Date(input.occurredAt), providerReported: true, reasonCode: input.scenario, now });
      const payloadHash = sha256(JSON.stringify({ ...input, address: normalized.success ? normalized.hash : "invalid" }));
      const inbox = await tx.webhookInbox.create({ data: { workspaceId: context.workspaceId, connectionId: foundation.connection.id, providerEventId: input.externalEventId, eventType: "communication.message.received", contractVersion: OMNICHANNEL_CONTRACT_VERSION, payloadHash, nonceHash: sha256(`nonce:${input.externalEventId}`), payloadSizeBytes: Buffer.byteLength(input.body, "utf8"), payload: json({ channel: input.channel, scenario: input.scenario, addressHash: normalized.success ? normalized.hash : null }), dataClass: "OPERATIONAL", signatureStatus: "VERIFIED", externalOccurredAt: new Date(input.occurredAt), receivedAt: now, status: "PROCESSED", attempts: 1, processedAt: now, correlationId: input.externalEventId, messageId: message.id } });
      await tx.job.create({ data: { workspaceId: context.workspaceId, type: "WEBHOOK", status: "SUCCEEDED", idempotencyKey: `omnichannel-webhook:${input.externalEventId}`, payload: json({ inboxId: inbox.id, messageId: message.id, externalEgress: false }), result: json({ processed: true }), createdByActorId: foundation.actor.id, updatedByActorId: foundation.actor.id, runAt: now, finishedAt: now, attempts: 1, lastAttemptAt: now } });
      const previous = { status: conversation.status, assigneeMemberId: conversation.assigneeMemberId, queueId: conversation.queueId };
      conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { status: "PENDING_INTERNAL", unreadCount: { increment: 1 }, lastMessageAt: new Date(input.occurredAt), waitingSince: new Date(input.occurredAt), firstInboundAt: conversation.firstInboundAt ?? new Date(input.occurredAt), updatedByActorId: foundation.actor.id, revision: { increment: 1 } } });
      if (createdNew || previous.assigneeMemberId !== conversation.assigneeMemberId || previous.queueId !== conversation.queueId) {
        await tx.conversationAssignmentHistory.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, previousOwnerMemberId: null, previousQueueId: null, newOwnerMemberId: conversation.assigneeMemberId, newQueueId: conversation.queueId, reason: exact ? "Identidade exata vinculada à responsabilidade operacional existente." : "Identidade não resolvida encaminhada explicitamente à Fila Geral.", actorId: foundation.actor.id, occurredAt: now } });
      }
      if (!normalized.success || points.length !== 1 || !lead) {
        await tx.messageIdentityReview.create({ data: { workspaceId: context.workspaceId, conversationId: conversation.id, messageId: message.id, contactId: exact?.contactId ?? null, contactPointId: exact?.id ?? null, reason: !normalized.success ? "INVALID_ADDRESS" : points.length > 1 ? "MULTIPLE_CONTACT_MATCHES" : exact && !lead ? "CONTACT_WITHOUT_LEAD" : "CONTACT_NOT_FOUND", normalizedAddressHash: normalized.success ? normalized.hash : sha256(input.address), channel: input.channel, evidence: json({ exactMatches: points.length, leadCreated: false, intakeRequiredForCreation: true }), createdByActorId: foundation.actor.id } });
      }
      if (lead) {
        await tx.activity.create({ data: { workspaceId: context.workspaceId, leadId: lead.id, messageId: message.id, type: "MESSAGE_RECEIVED", direction: "INBOUND", result: "RECEIVED", subject: "Mensagem recebida no inbox", description: "Fato canônico de comunicação; conteúdo disponível na conversa.", occurredAt: new Date(input.occurredAt), createdByActorId: foundation.actor.id, updatedByActorId: foundation.actor.id } });
        await tx.lead.update({ where: { id: lead.id }, data: { awaitingHumanResponse: true, lastInboundResponseAt: new Date(input.occurredAt), lastActivityAt: new Date(input.occurredAt), updatedByActorId: foundation.actor.id } });
        if (input.scenario === "OPT_OUT") {
          await tx.contactPoint.update({ where: { id: exact!.id }, data: { doNotContact: true, updatedByActorId: foundation.actor.id } });
          await tx.lead.updateMany({ where: { workspaceId: context.workspaceId, contactId: exact!.contactId }, data: { contactPreference: "DO_NOT_CONTACT", contactPreferenceUpdatedAt: new Date(input.occurredAt), updatedByActorId: foundation.actor.id } });
          await cancelPendingOutboundForContactInTransaction(tx, { workspaceId: context.workspaceId, contactId: exact!.contactId, contactPointId: exact!.id, actorId: foundation.actor.id, now, reasonCode: "PRIVACY_INBOUND_OPT_OUT" });
        }
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: foundation.actor.id, action: "communication.inbound.received_local", entityType: "Message", entityId: message.id, origin: "SYSTEM", requestId: input.externalEventId, changes: json({ channel: input.channel, identity: exact && lead ? "EXACT" : "REVIEW_REQUIRED", conversationStatus: "PENDING_INTERNAL", externalEgress: false }) } });
      return { outcome: exact && lead ? "ATTACHED" as const : "REVIEW_REQUIRED" as const, webhookId: inbox.id, messageId: message.id, conversationId: conversation.id, leadId: lead?.id ?? null };
    });
  }

  async function composeAndEnqueue(context: AuthenticatedContext, raw: unknown) {
    const input = composeMessageSchema.parse(raw);
    const conversation = await loadConversation(options, context, input.conversationId, PermissionKeys.MESSAGES_COMPOSE);
    await options.authorization.assertAuthorized(context, PermissionKeys.MESSAGES_SEND, conversationResource(conversation));
    const now = options.now();
    return withSerializableRetry(options.database, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`omnichannel-outbound:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      const existing = await tx.message.findFirst({ where: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey }, include: { outboxEvents: true } });
      if (existing) {
        if (existing.conversationId !== input.conversationId || existing.bodyHash !== sha256(input.body)) fail("A chave idempotente já foi usada com outro conteúdo.", "IDEMPOTENCY_CONFLICT", 409);
        return { messageId: existing.id, status: existing.status, idempotent: true, outboxId: existing.outboxEvents[0]?.id ?? null };
      }
      const row = await tx.conversation.findFirst({ where: { id: conversation.id, workspaceId: context.workspaceId }, include: { contactPoint: true, connection: true } });
      if (!row) fail("Conversa não encontrada.", "CONVERSATION_NOT_FOUND", 404);
      if (row.channel === "EMAIL" && !input.subject?.trim()) fail("E-mail exige assunto.", "EMAIL_SUBJECT_REQUIRED", 422);
      const privacy = row.leadId ? await evaluatePrivacy(tx, { workspaceId: context.workspaceId, actorId: context.actorId, leadId: row.leadId, contactPointId: row.contactPointId, channel: channelPrivacyChannel(row.channel as SupportedConversationChannel), intendedAction: "OMNICHANNEL_OUTBOUND_SEND", persist: true }) : null;
      const templateVersion = input.templateVersionId ? await tx.messageTemplateVersion.findFirst({ where: { id: input.templateVersionId, workspaceId: context.workspaceId }, include: { template: true } }) : null;
      if (input.templateVersionId && (!templateVersion || templateVersion.template.channel !== row.channel)) fail("Template não pertence ao canal desta conversa.", "MESSAGE_TEMPLATE_CHANNEL_MISMATCH", 422);
      const whatsappPolicy = row.channel === "WHATSAPP" ? evaluateWhatsAppOutboundPolicy({ lastCustomerInboundAt: row.lastCustomerInboundAt, now, hasTemplate: Boolean(templateVersion), providerTemplateStatus: templateVersion?.template.providerStatus ?? null, optOut: Boolean(row.contactPoint?.doNotContact) }) : null;
      const whatsappProfile = row.channel === "WHATSAPP" && row.connectionId ? await tx.whatsAppConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId, connectionId: row.connectionId } }) : null;
      const emailProfile = row.channel === "EMAIL" && row.connectionId ? await tx.emailConnectionProfile.findFirst({ where: { workspaceId: context.workspaceId, connectionId: row.connectionId } }) : null;
      const latestEmail = row.channel === "EMAIL" ? await tx.emailMessageProfile.findFirst({ where: { workspaceId: context.workspaceId, message: { conversationId: row.id } }, orderBy: { message: { occurredAt: "desc" } } }) : null;
      const latestSuppression = row.channel === "EMAIL" && row.contactPoint?.normalizedValue ? await tx.emailSuppression.findFirst({ where: { workspaceId: context.workspaceId, normalizedEmail: row.contactPoint.normalizedValue, purposeKey: "legacy-commercial-contact" }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] }) : null;
      const suppressed = latestSuppression?.action === "APPLIED";
      const channelReady = row.channel === "WHATSAPP"
        ? Boolean(whatsappProfile && whatsappProfile.operatingMode === "LOCAL_SIMULATOR" && row.connection?.enabled)
        : row.channel === "EMAIL"
          ? Boolean(emailProfile && emailProfile.operatingMode === "LOCAL_SINK" && row.connection?.enabled)
          : true;
      const allowed = privacy?.outcome === "ALLOW" && (whatsappPolicy?.allowed ?? true) && channelReady && !suppressed;
      const policyReason = privacy?.outcome !== "ALLOW" ? `PRIVACY_${privacy?.outcome ?? "REVIEW_REQUIRED"}` : suppressed ? "EMAIL_SUPPRESSED" : !channelReady ? `${row.channel}_DELIVERY_MODE_INACTIVE` : whatsappPolicy?.code ?? "PRIVACY_ALLOW";
      const messageId = randomUUID();
      const message = await tx.message.create({ data: { id: messageId, workspaceId: context.workspaceId, conversationId: row.id, senderActorId: context.actorId, direction: "OUTBOUND", type: input.templateVersionId ? "TEMPLATE" : "TEXT", status: allowed ? "QUEUED" : "BLOCKED_BY_POLICY", subject: input.subject ?? null, body: input.body, bodyHash: sha256(input.body), providerKey: row.channel === "WHATSAPP" ? WHATSAPP_LOCAL_PROVIDER_KEY : row.channel === "EMAIL" ? EMAIL_PROVIDER_KEY : "LOCAL_SIMULATOR", idempotencyKey: input.idempotencyKey, clientCorrelationId: input.clientCorrelationId, privacyDecisionId: privacy?.decisionId ?? null, purposeVersionId: privacy?.purpose?.versionId ?? null, isSimulated: true, simulationLabel: row.channel === "WHATSAPP" ? "Envio WhatsApp somente local; nenhum dado foi enviado à Meta." : row.channel === "EMAIL" ? "E-mail aceito somente pelo sink local; nenhum dado saiu deste ambiente." : "Envio apenas local e determinístico; nenhum provider externo foi acionado.", occurredAt: now } });
      if (row.channel === "EMAIL" && emailProfile && row.contactPoint?.normalizedValue) {
        const header = createStableMessageId(context.workspaceId, message.id, emailProfile.domain);
        const emailReferences = normalizeReferenceChain([...(latestEmail?.referencesHeaders ?? []), ...(latestEmail ? [latestEmail.messageIdHeader] : [])]);
        const emailMessage = await tx.emailMessageProfile.create({ data: { workspaceId: context.workspaceId, profileId: emailProfile.id, messageId: message.id, messageIdHeader: header, inReplyToHeader: latestEmail?.messageIdHeader ?? null, referencesHeaders: emailReferences, textBodyHash: message.bodyHash!, hasSanitizedHtml: false } });
        await tx.emailRecipient.create({ data: { workspaceId: context.workspaceId, emailMessageId: emailMessage.id, type: "TO", normalizedAddress: row.contactPoint.normalizedValue, maskedAddress: row.contactPoint.normalizedValue.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2") } });
      }
      await appendStatus(tx, { workspaceId: context.workspaceId, messageId: message.id, status: allowed ? "QUEUED" : "BLOCKED_BY_POLICY", source: "INTERNAL", actorId: context.actorId, reasonCode: policyReason, now });
      let outboxId: string | null = null;
      if (allowed) {
        const foundation = await localFoundation(tx, context.workspaceId, row.channel as SupportedConversationChannel);
        const deliveryConnectionId = row.channel === "WHATSAPP" && row.connectionId ? row.connectionId : foundation.connection.id;
        const payload = { messageId: message.id, conversationId: row.id, leadId: row.leadId, channel: row.channel, bodyHash: message.bodyHash, externalEgress: false };
        const outbox = await tx.outboxEvent.create({ data: { workspaceId: context.workspaceId, connectionId: deliveryConnectionId, eventType: "communication.message.send", eventVersion: OMNICHANNEL_CONTRACT_VERSION, aggregateType: "Message", aggregateId: message.id, correlationId: input.clientCorrelationId, idempotencyKey: `outbox:${input.idempotencyKey}`, payload: json(payload), payloadHash: sha256(JSON.stringify(payload)), status: "PENDING", availableAt: now, createdByActorId: context.actorId, messageId: message.id } });
        const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "OMNICHANNEL_MESSAGE", idempotencyKey: `message:${input.idempotencyKey}`, priority: row.priority === "URGENT" ? 100 : row.priority === "HIGH" ? 75 : row.priority === "MEDIUM" ? 50 : 25, runAt: now, payload: json({ messageId: message.id, outboxId: outbox.id, externalEgress: false }), maxAttempts: MESSAGE_JOB_MAX_ATTEMPTS, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        await tx.messageDeliveryAttempt.create({ data: { workspaceId: context.workspaceId, messageId: message.id, outboxId: outbox.id, jobId: job.id, attemptNumber: 1, status: "RUNNING", startedAt: now } });
        outboxId = outbox.id;
      }
      const firstHumanResponseAt = row.firstHumanResponseAt ?? now;
      await tx.conversation.update({ where: { id: row.id }, data: { status: allowed ? "WAITING_CUSTOMER" : row.status, lastMessageAt: now, firstHumanResponseAt, firstResponseSeconds: row.firstInboundAt && !row.firstHumanResponseAt ? Math.max(0, Math.floor((now.getTime() - row.firstInboundAt.getTime()) / 1_000)) : row.firstResponseSeconds, waitingSince: allowed ? now : row.waitingSince, unreadCount: allowed ? 0 : row.unreadCount, updatedByActorId: context.actorId, revision: { increment: 1 } } });
      if (row.leadId) await tx.activity.create({ data: { workspaceId: context.workspaceId, leadId: row.leadId, messageId: message.id, type: "MESSAGE_SENT", direction: "OUTBOUND", result: allowed ? "SENT" : "OTHER", subject: allowed ? "Mensagem enfileirada no inbox" : "Mensagem bloqueada pela privacidade", description: allowed ? "Entrega simulada aguardando processamento local." : "Nenhum envio ocorreu; decisão exige revisão ou bloqueia contato.", occurredAt: now, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: allowed ? "communication.message.queued" : "communication.message.blocked_by_policy", entityType: "Message", entityId: message.id, changes: json({ privacyOutcome: privacy?.outcome ?? "REVIEW_REQUIRED", channel: row.channel, whatsappPolicy: whatsappPolicy ? { allowed: whatsappPolicy.allowed, code: whatsappPolicy.code } : null, emailSuppressed: suppressed, channelReady, externalEgress: false }) } });
      return { messageId: message.id, status: allowed ? "QUEUED" as const : "BLOCKED_BY_POLICY" as const, idempotent: false, outboxId, privacyOutcome: privacy?.outcome ?? "REVIEW_REQUIRED", policyCode: policyReason };
    });
  }

  async function simulateDelivery(context: AuthenticatedContext, raw: unknown) {
    const input = deliveryScenarioSchema.parse(raw);
    const messageSnapshot = await options.database.message.findFirst({ where: { id: input.messageId, workspaceId: context.workspaceId }, include: { conversation: { include: { queue: { select: { teamId: true } } } } } });
    if (!messageSnapshot) fail("Mensagem não encontrada.", "MESSAGE_NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.MESSAGES_REPLAY, conversationResource(messageSnapshot.conversation));
    const now = options.now();
    return withSerializableRetry(options.database, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`omnichannel-delivery:${context.workspaceId}:${input.messageId}`}, 0))`;
      const duplicate = await tx.messageStatusEvent.findFirst({ where: { workspaceId: context.workspaceId, providerKey: "LOCAL_SIMULATOR", externalEventId: input.externalEventId } });
      if (duplicate) return { messageId: input.messageId, status: duplicate.status, idempotent: true };
      const message = await tx.message.findFirst({ where: { id: input.messageId, workspaceId: context.workspaceId }, include: { conversation: true, outboxEvents: { orderBy: { createdAt: "desc" }, take: 1 }, deliveryAttempts: { orderBy: { attemptNumber: "desc" }, take: 1 } } });
      if (!message) fail("Mensagem não encontrada.", "MESSAGE_NOT_FOUND", 404);
      const outbox = message.outboxEvents[0] ?? null;
      const previousAttempt = message.deliveryAttempts[0] ?? null;
      if (["FAILED_TRANSIENT", "QUEUED", "ACCEPTED_INTERNAL"].includes(message.status) && message.conversation.leadId) {
        const privacy = await evaluatePrivacy(tx, { workspaceId: context.workspaceId, actorId: context.actorId, leadId: message.conversation.leadId, contactPointId: message.conversation.contactPointId, channel: channelPrivacyChannel(message.conversation.channel as SupportedConversationChannel), intendedAction: "OMNICHANNEL_RETRY", persist: true });
        if (privacy.outcome !== "ALLOW") {
          await appendStatus(tx, { workspaceId: context.workspaceId, messageId: message.id, status: "CANCELLED", source: "INTERNAL", actorId: context.actorId, externalEventId: input.externalEventId, reasonCode: `PRIVACY_${privacy.outcome}`, now });
          if (outbox) await tx.outboxEvent.update({ where: { id: outbox.id }, data: { status: "CANCELLED", nextRetryAt: null, errorClass: "PRIVACY_BLOCKED", errorCode: `PRIVACY_${privacy.outcome}`, errorMessage: "Entrega cancelada após nova decisão de privacidade." } });
          if (previousAttempt?.jobId) await tx.job.update({ where: { id: previousAttempt.jobId }, data: { status: "CANCELLED", cancelledAt: now, finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: context.actorId } });
          return { messageId: message.id, status: "CANCELLED" as const, idempotent: false, privacyOutcome: privacy.outcome };
        }
      }
      const status: MessageStatus = input.scenario === "SENT" ? "SENT" : input.scenario === "DELIVERED" ? "DELIVERED" : input.scenario === "READ" ? "READ" : input.scenario === "REPLY" ? "REPLIED" : input.scenario === "TRANSIENT_FAILURE" ? "FAILED_TRANSIENT" : input.scenario === "PERMANENT_FAILURE" ? "FAILED_PERMANENT" : input.scenario === "BOUNCED" ? "BOUNCED" : input.scenario === "DEFERRED" ? "DEFERRED" : input.scenario === "SOFT_BOUNCE" ? "SOFT_BOUNCE" : input.scenario === "HARD_BOUNCE" ? "HARD_BOUNCE" : input.scenario === "COMPLAINT" ? "COMPLAINT" : input.scenario === "REJECTED" ? "REJECTED" : input.scenario === "UNSUBSCRIBED" ? "UNSUBSCRIBED" : input.scenario === "UNKNOWN_REVIEW" ? "UNKNOWN_REVIEW" : input.scenario === "PROVIDER_ACCEPTED" ? "PROVIDER_ACCEPTED" : "ACCEPTED_INTERNAL";
      const attemptNumber = (previousAttempt?.attemptNumber ?? 0) + (previousAttempt?.finishedAt ? 1 : 0);
      const retryAt = ["TRANSIENT_FAILURE", "DELAY", "DEFERRED", "SOFT_BOUNCE"].includes(input.scenario) ? new Date(now.getTime() + RETRY_DELAY_SECONDS * 1_000) : null;
      const permanent = ["PERMANENT_FAILURE", "BOUNCED", "HARD_BOUNCE", "COMPLAINT", "REJECTED", "UNSUBSCRIBED"].includes(input.scenario);
      if (previousAttempt && !previousAttempt.finishedAt) {
        await tx.messageDeliveryAttempt.update({ where: { id: previousAttempt.id }, data: { status: retryAt ? "RETRY_PENDING" : permanent ? "FAILED_PERMANENT" : input.scenario === "ACCEPTED" ? "ACCEPTED_INTERNAL" : "SUCCEEDED", finishedAt: now, retryable: Boolean(retryAt), nextRetryAt: retryAt, errorCode: retryAt || permanent ? input.scenario : null, errorClassification: retryAt ? "TRANSIENT" : permanent ? "PERMANENT" : null, providerRequestId: input.externalEventId } });
      } else {
        await tx.messageDeliveryAttempt.create({ data: { workspaceId: context.workspaceId, messageId: message.id, outboxId: outbox?.id ?? null, jobId: previousAttempt?.jobId ?? null, attemptNumber: Math.max(1, attemptNumber), status: retryAt ? "RETRY_PENDING" : permanent ? "FAILED_PERMANENT" : input.scenario === "ACCEPTED" ? "ACCEPTED_INTERNAL" : "SUCCEEDED", startedAt: now, finishedAt: now, retryable: Boolean(retryAt), nextRetryAt: retryAt, providerRequestId: input.externalEventId } });
      }
      await appendStatus(tx, { workspaceId: context.workspaceId, messageId: message.id, status, source: "LOCAL_SIMULATOR", actorId: context.actorId, externalEventId: input.externalEventId, providerOccurredAt: now, providerReported: true, reasonCode: input.scenario, now });
      if (outbox) await tx.outboxEvent.update({ where: { id: outbox.id }, data: { status: retryAt ? "RETRY_PENDING" : permanent ? "DEAD_LETTER" : "DELIVERED_LOCAL", deliveredLocallyAt: retryAt ? null : now, nextRetryAt: retryAt, attempts: { increment: 1 }, errorClass: retryAt ? "TRANSIENT" : permanent ? "PERMANENT" : null, errorCode: retryAt || permanent ? status : null, errorMessage: retryAt || permanent ? "Resultado determinístico do simulador local." : null } });
      if (previousAttempt?.jobId) await tx.job.update({ where: { id: previousAttempt.jobId }, data: { status: retryAt ? "PENDING" : permanent ? "FAILED" : "SUCCEEDED", runAt: retryAt ?? now, attempts: { increment: 1 }, lastAttemptAt: now, finishedAt: retryAt ? null : now, errorCode: retryAt || permanent ? status : null, lastError: retryAt || permanent ? "Resultado determinístico do simulador local." : null, updatedByActorId: context.actorId } });
      if (message.conversation.channel === "EMAIL" && ["HARD_BOUNCE", "COMPLAINT", "UNSUBSCRIBED"].includes(status) && message.conversation.contactPointId) {
        const point = await tx.contactPoint.findFirst({ where: { id: message.conversation.contactPointId, workspaceId: context.workspaceId } });
        if (point) {
          await tx.emailSuppression.create({ data: { workspaceId: context.workspaceId, contactPointId: point.id, normalizedEmail: point.normalizedValue, purposeKey: "legacy-commercial-contact", action: "APPLIED", reasonCode: status, source: "LOCAL_SIMULATOR", externalEventId: input.externalEventId, effectiveAt: now, createdByActorId: context.actorId } });
          await tx.contactPoint.update({ where: { id: point.id }, data: { doNotContact: true, updatedByActorId: context.actorId } });
        }
      }
      if (input.scenario === "REPLY") {
        const foundation = await localFoundation(tx, context.workspaceId, message.conversation.channel as SupportedConversationChannel);
        const reply = await tx.message.create({ data: { workspaceId: context.workspaceId, conversationId: message.conversationId, senderActorId: foundation.actor.id, replyToMessageId: message.id, direction: "INBOUND", status: "RECEIVED", body: "SIMULAÇÃO LOCAL — resposta recebida.", bodyHash: sha256("SIMULAÇÃO LOCAL — resposta recebida."), providerKey: "LOCAL_SIMULATOR", externalMessageId: `${input.externalEventId}:reply`, idempotencyKey: `reply:${input.externalEventId}`, clientCorrelationId: input.externalEventId, isSimulated: true, simulationLabel: "Resposta criada pelo simulador local.", occurredAt: now, receivedAt: now } });
        await appendStatus(tx, { workspaceId: context.workspaceId, messageId: reply.id, status: "RECEIVED", source: "LOCAL_SIMULATOR", actorId: foundation.actor.id, externalEventId: `${input.externalEventId}:reply`, providerOccurredAt: now, providerReported: true, reasonCode: "SIMULATED_REPLY", now });
        await tx.conversation.update({ where: { id: message.conversationId }, data: { status: "PENDING_INTERNAL", unreadCount: { increment: 1 }, waitingSince: now, lastMessageAt: now, updatedByActorId: foundation.actor.id, revision: { increment: 1 } } });
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "communication.delivery.simulated", entityType: "Message", entityId: message.id, requestId: input.externalEventId, changes: json({ scenario: input.scenario, status, externalEgress: false }) } });
      return { messageId: message.id, status, idempotent: false, retryAt: retryAt?.toISOString() ?? null };
    });
  }

  async function command(context: AuthenticatedContext, raw: unknown) {
    const input = conversationCommandSchema.parse(raw);
    const permission = input.action === "CLAIM" || input.action === "TRANSFER" ? PermissionKeys.CONVERSATIONS_ASSIGN : PermissionKeys.CONVERSATIONS_MANAGE;
    await loadConversation(options, context, input.conversationId, permission);
    const now = options.now();
    return withSerializableRetry(options.database, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation-command:${context.workspaceId}:${input.conversationId}`}, 0))`;
      const current = await tx.conversation.findFirst({ where: { id: input.conversationId, workspaceId: context.workspaceId } });
      if (!current) fail("Conversa não encontrada.", "CONVERSATION_NOT_FOUND", 404);
      if (current.revision !== input.expectedRevision) fail("A conversa foi alterada por outra pessoa. Atualize antes de tentar novamente.", "CONVERSATION_CONFLICT", 409);
      let data: Prisma.ConversationUncheckedUpdateInput;
      if (input.action === "MARK_READ") data = { unreadCount: input.unread ? Math.max(1, current.unreadCount) : 0 };
      else if (input.action === "RESOLVE") data = { status: "RESOLVED", resolvedAt: now, waitingSince: null };
      else if (input.action === "REOPEN") data = { status: "PENDING_INTERNAL", resolvedAt: null, closedAt: null, archivedAt: null, waitingSince: now };
      else if (input.action === "ARCHIVE") data = { status: "ARCHIVED", archivedAt: now, waitingSince: null };
      else if (input.action === "CLAIM") data = { assigneeMemberId: context.memberId, queueId: null };
      else {
        if (input.memberId) {
          const member = await tx.workspaceMember.findFirst({ where: { id: input.memberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null } });
          if (!member) fail("Responsável não está ativo neste workspace.", "MEMBER_NOT_AVAILABLE", 409);
        }
        if (input.queueId) {
          const queue = await tx.queue.findFirst({ where: { id: input.queueId, workspaceId: context.workspaceId, deletedAt: null } });
          if (!queue) fail("Fila não encontrada neste workspace.", "QUEUE_NOT_FOUND", 404);
        }
        data = input.memberId ? { assigneeMemberId: input.memberId, queueId: null } : { assigneeMemberId: null, queueId: input.queueId! };
      }
      const updated = await tx.conversation.update({ where: { id: current.id }, data: { ...data, updatedByActorId: context.actorId, revision: { increment: 1 } } });
      if (input.action === "CLAIM" || input.action === "TRANSFER") await tx.conversationAssignmentHistory.create({ data: { workspaceId: context.workspaceId, conversationId: current.id, previousOwnerMemberId: current.assigneeMemberId, previousQueueId: current.queueId, newOwnerMemberId: updated.assigneeMemberId, newQueueId: updated.queueId, reason: input.reason, actorId: context.actorId, occurredAt: now } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `conversation.${input.action.toLowerCase()}`, entityType: "Conversation", entityId: current.id, reason: "reason" in input ? input.reason : null, changes: json({ previousStatus: current.status, nextStatus: updated.status, previousOwnerMemberId: current.assigneeMemberId, nextOwnerMemberId: updated.assigneeMemberId, previousQueueId: current.queueId, nextQueueId: updated.queueId }) } });
      return { id: updated.id, status: updated.status, revision: updated.revision, assigneeMemberId: updated.assigneeMemberId, queueId: updated.queueId };
    });
  }

  async function saveTemplate(context: AuthenticatedContext, raw: unknown) {
    const input = templateInputSchema.parse(raw);
    await options.authorization.assertAuthorized(context, PermissionKeys.MESSAGE_TEMPLATES_MANAGE, { workspaceId: context.workspaceId, resourceType: "MessageTemplate", ownerMemberId: context.memberId });
    const now = options.now();
    return withSerializableRetry(options.database, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`message-template:${context.workspaceId}:${input.key}`}, 0))`;
      const current = await tx.messageTemplate.findUnique({ where: { workspaceId_key: { workspaceId: context.workspaceId, key: input.key } } });
      const nextVersion = (current?.currentVersion ?? 0) + 1;
      const template = current ? await tx.messageTemplate.update({ where: { id: current.id }, data: { name: input.name, channel: input.channel, locale: input.locale, category: input.category, status: input.publish ? "ACTIVE_LOCAL" : "DRAFT", currentVersion: nextVersion, updatedByActorId: context.actorId } }) : await tx.messageTemplate.create({ data: { workspaceId: context.workspaceId, key: input.key, name: input.name, channel: input.channel, locale: input.locale, category: input.category, status: input.publish ? "ACTIVE_LOCAL" : "DRAFT", currentVersion: nextVersion, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      const version = await tx.messageTemplateVersion.create({ data: { workspaceId: context.workspaceId, templateId: template.id, version: nextVersion, bodyTemplate: input.bodyTemplate, subjectTemplate: input.subjectTemplate ?? null, variables: input.variables, contentHash: sha256(JSON.stringify({ body: input.bodyTemplate, subject: input.subjectTemplate ?? null, variables: input.variables })), createdByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "communication.template.versioned", entityType: "MessageTemplate", entityId: template.id, changes: json({ version: nextVersion, status: template.status, channel: template.channel }) } });
      return { id: template.id, versionId: version.id, version: nextVersion, status: template.status, createdAt: now.toISOString() };
    });
  }

  async function getLeadSummary(context: AuthenticatedContext, leadId: string) {
    const scoped = await getScopedWhere(options, context);
    const base = { workspaceId: context.workspaceId, leadId, deletedAt: null, ...scoped } satisfies Prisma.ConversationWhereInput;
    const [conversations, total, open, waitingTeam, waitingCustomer, unread, inbound, outbound] = await Promise.all([
      options.database.conversation.findMany({ where: base, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], take: 5, select: { id: true, channel: true, status: true, lastMessageAt: true, unreadCount: true } }),
      options.database.conversation.count({ where: base }),
      options.database.conversation.count({ where: { ...base, status: { in: ["OPEN", "PENDING_INTERNAL", "WAITING_CUSTOMER"] } } }),
      options.database.conversation.count({ where: { ...base, status: "PENDING_INTERNAL" } }),
      options.database.conversation.count({ where: { ...base, status: "WAITING_CUSTOMER" } }),
      options.database.conversation.aggregate({ where: base, _sum: { unreadCount: true } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND", conversation: base } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "OUTBOUND", conversation: base } }),
    ]);
    return {
      conversationCount: total,
      openCount: open,
      waitingTeamCount: waitingTeam,
      waitingCustomerCount: waitingCustomer,
      unreadCount: unread._sum.unreadCount ?? 0,
      inboundMessageCount: inbound,
      outboundMessageCount: outbound,
      recent: conversations.map((conversation) => ({ ...conversation, lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null })),
    };
  }

  async function getMetrics(context: AuthenticatedContext) {
    const scoped = await getScopedWhere(options, context);
    const now = options.now();
    const base = { workspaceId: context.workspaceId, deletedAt: null, ...scoped } satisfies Prisma.ConversationWhereInput;
    const [open, unread, overdue, waitingCustomer, reviews, inbound, outbound, responses] = await Promise.all([
      options.database.conversation.count({ where: { ...base, status: { in: ["OPEN", "PENDING_INTERNAL", "WAITING_CUSTOMER"] } } }),
      options.database.conversation.count({ where: { ...base, unreadCount: { gt: 0 } } }),
      options.database.conversation.count({ where: { ...base, status: "PENDING_INTERNAL", waitingSince: { lt: new Date(now.getTime() - 180_000) } } }),
      options.database.conversation.count({ where: { ...base, status: "WAITING_CUSTOMER" } }),
      options.database.messageIdentityReview.count({ where: { workspaceId: context.workspaceId, status: "OPEN", conversation: base } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "INBOUND", conversation: base } }),
      options.database.message.count({ where: { workspaceId: context.workspaceId, direction: "OUTBOUND", conversation: base } }),
      options.database.conversation.aggregate({ where: { ...base, firstResponseSeconds: { not: null } }, _avg: { firstResponseSeconds: true }, _count: { firstResponseSeconds: true } }),
    ]);
    return { open, unread, overdue, waitingCustomer, identityReview: reviews, inboundMessages: inbound, outboundMessages: outbound, firstResponseAverageSeconds: responses._avg.firstResponseSeconds, firstResponseCount: responses._count.firstResponseSeconds, generatedAt: now.toISOString(), drilldowns: { open: "/inbox?view=ALL", unread: "/inbox?view=UNREAD", overdue: "/inbox?view=OVERDUE", waitingCustomer: "/inbox?view=WAITING_CUSTOMER" } };
  }

  return Object.freeze({ getInbox, getConversation, getLeadSummary, receiveLocal, composeAndEnqueue, simulateDelivery, command, saveTemplate, getMetrics });
}

let service: ReturnType<typeof createOmnichannelService> | undefined;
export function getOmnichannelService() {
  service ??= createOmnichannelService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}

export function makeLocalEventId(prefix = "event") {
  return `${prefix}:${randomUUID()}`;
}
