import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ensureContactForLeadInTransaction } from "@/modules/contacts/application/contact-identity-service";

const SEED_NAMESPACE = "crm43-omnichannel-demo-v1";

function stableId(key: string) {
  const chars = createHash("sha256").update(`${SEED_NAMESPACE}:${key}`).digest("hex").split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function ensureTemplate(tx: Prisma.TransactionClient, workspaceId: string, actorId: string) {
  const templateId = stableId("template:first-response");
  const versionId = stableId("template:first-response:1");
  await tx.messageTemplate.upsert({
    where: { workspaceId_key: { workspaceId, key: "primeira-resposta-local" } },
    update: {},
    create: { id: templateId, workspaceId, key: "primeira-resposta-local", name: "Primeira resposta local", channel: "INTERNAL_SIMULATOR", locale: "pt-BR", category: "Atendimento", status: "ACTIVE_LOCAL", currentVersion: 1, createdByActorId: actorId, updatedByActorId: actorId },
  });
  await tx.messageTemplateVersion.upsert({
    where: { workspaceId_templateId_version: { workspaceId, templateId, version: 1 } },
    update: {},
    create: { id: versionId, workspaceId, templateId, version: 1, bodyTemplate: "Olá, {{nome}}. Recebemos sua mensagem e vamos continuar o atendimento por aqui.", variables: ["nome"], contentHash: hash("Olá, {{nome}}. Recebemos sua mensagem e vamos continuar o atendimento por aqui."), createdByActorId: actorId },
  });
  const emailTemplateId = stableId("template:email-follow-up");
  await tx.messageTemplate.upsert({ where: { workspaceId_key: { workspaceId, key: "email-retorno-local" } }, update: {}, create: { id: emailTemplateId, workspaceId, key: "email-retorno-local", name: "Retorno comercial por e-mail", channel: "EMAIL", locale: "pt-BR", category: "Atendimento", status: "ACTIVE_LOCAL", currentVersion: 1, createdByActorId: actorId, updatedByActorId: actorId } });
  await tx.messageTemplateVersion.upsert({ where: { workspaceId_templateId_version: { workspaceId, templateId: emailTemplateId, version: 1 } }, update: {}, create: { id: stableId("template:email-follow-up:1"), workspaceId, templateId: emailTemplateId, version: 1, subjectTemplate: "Próximos passos — {{nome}}", bodyTemplate: "Olá, {{nome}}. Seguem os próximos passos combinados.", variables: ["nome"], contentHash: hash("Próximos passos — {{nome}}|Olá, {{nome}}. Seguem os próximos passos combinados."), createdByActorId: actorId } });
}

export async function seedOmnichannelDemoData(database: PrismaClient, now = new Date()) {
  return database.$transaction(async (tx) => {
    const workspace = await tx.workspace.findFirst({ where: { slug: "politizai", deletedAt: null } });
    if (!workspace) throw new Error("Workspace Politizai ausente para o seed CRM-43.");
    const [actor, queue, connection, emailConnection, emailProfile] = await Promise.all([
      tx.actor.findFirst({ where: { workspaceId: workspace.id, type: "SYSTEM" }, orderBy: { createdAt: "asc" } }),
      tx.queue.findFirst({ where: { workspaceId: workspace.id, isGeneral: true, deletedAt: null } }),
      tx.integrationConnection.findFirst({ where: { workspaceId: workspace.id, key: "local-mock", environment: "LOCAL" } }),
      tx.integrationConnection.findFirst({ where: { workspaceId: workspace.id, key: "email-local-sink", environment: "LOCAL" } }),
      tx.emailConnectionProfile.findFirst({ where: { workspaceId: workspace.id, operatingMode: "LOCAL_SINK" } }),
    ]);
    if (!actor || !queue || !connection || !emailConnection || !emailProfile) throw new Error("Fundação local incompleta para o seed CRM-43/45.");
    const legacyDemoLeads = await tx.lead.findMany({ where: { workspaceId: workspace.id, contactId: null, deletedAt: null, OR: [{ normalizedPhone: { not: null } }, { normalizedEmail: { not: null } }] }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 10, select: { id: true, fullName: true, jobTitle: true, normalizedPhone: true, normalizedEmail: true, contactPreference: true } });
    for (const lead of legacyDemoLeads) {
      const identity = await ensureContactForLeadInTransaction(tx, { workspaceId: workspace.id, actorId: actor.id, facts: { leadId: lead.id, fullName: lead.fullName, jobTitle: lead.jobTitle, normalizedPhone: lead.normalizedPhone, originalPhone: lead.normalizedPhone, normalizedEmail: lead.normalizedEmail, originalEmail: lead.normalizedEmail, doNotContact: lead.contactPreference === "DO_NOT_CONTACT", origin: "LEAD_BACKFILL" } });
      await tx.leadFormSubmission.updateMany({ where: { workspaceId: workspace.id, leadId: lead.id, contactId: null }, data: { contactId: identity.contactId } });
    }
    const [leads, emailLeads] = await Promise.all([
      tx.lead.findMany({ where: { workspaceId: workspace.id, contactId: { not: null }, deletedAt: null, contact: { points: { some: { type: "PHONE", deletedAt: null } } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 7, include: { contact: { include: { points: { where: { type: "PHONE", deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } } } } }),
      tx.lead.findMany({ where: { workspaceId: workspace.id, contactId: { not: null }, deletedAt: null, contact: { points: { some: { type: "EMAIL", deletedAt: null } } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 3, include: { contact: { include: { points: { where: { type: "EMAIL", deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } } } } }),
    ]);
    await ensureTemplate(tx, workspace.id, actor.id);
    const definitions = [
      { key: "unread", status: "PENDING_INTERNAL", unread: 2, minutes: 2, message: "Tenho interesse e preciso entender os próximos passos.", messageStatus: "RECEIVED", direction: "INBOUND" },
      { key: "overdue", status: "PENDING_INTERNAL", unread: 1, minutes: 18, message: "Podemos falar ainda hoje?", messageStatus: "RECEIVED", direction: "INBOUND" },
      { key: "waiting", status: "WAITING_CUSTOMER", unread: 0, minutes: 42, message: "SIMULAÇÃO LOCAL — enviei os horários disponíveis.", messageStatus: "DELIVERED", direction: "OUTBOUND" },
      { key: "resolved", status: "RESOLVED", unread: 0, minutes: 160, message: "Obrigado, ficou combinado.", messageStatus: "READ", direction: "OUTBOUND" },
      { key: "transient", status: "WAITING_CUSTOMER", unread: 0, minutes: 7, message: "SIMULAÇÃO LOCAL — retorno operacional.", messageStatus: "FAILED_TRANSIENT", direction: "OUTBOUND" },
      { key: "delivered", status: "WAITING_CUSTOMER", unread: 0, minutes: 25, message: "SIMULAÇÃO LOCAL — briefing confirmado.", messageStatus: "DELIVERED", direction: "OUTBOUND" },
      { key: "reply", status: "PENDING_INTERNAL", unread: 1, minutes: 4, message: "Sim, esse horário funciona para mim.", messageStatus: "RECEIVED", direction: "INBOUND" },
    ] as const;
    let created = 0;
    for (const [index, definition] of definitions.entries()) {
      const lead = leads[index];
      if (!lead?.contactId || !lead.contact?.points[0]) continue;
      const occurredAt = new Date(now.getTime() - definition.minutes * 60_000);
      const conversationId = stableId(`conversation:${definition.key}`);
      const messageId = stableId(`message:${definition.key}`);
      const participantId = stableId(`participant:${definition.key}`);
      const ownerMemberId = lead.ownerMemberId;
      const queueId = ownerMemberId ? null : lead.queueId ?? queue.id;
      const conversation = await tx.conversation.upsert({
        where: { id: conversationId },
        update: {},
        create: { id: conversationId, workspaceId: workspace.id, contactId: lead.contactId, contactPointId: lead.contact.points[0].id, accountId: lead.accountId, leadId: lead.id, connectionId: connection.id, assigneeMemberId: ownerMemberId, queueId, channel: "INTERNAL_SIMULATOR", status: definition.status, subject: `Demonstração — ${definition.key}`, priority: lead.priority, externalThreadId: `seed:${definition.key}`, unreadCount: definition.unread, firstInboundAt: definition.direction === "INBOUND" ? occurredAt : new Date(occurredAt.getTime() - 120_000), firstHumanResponseAt: definition.direction === "OUTBOUND" ? occurredAt : null, firstResponseSeconds: definition.direction === "OUTBOUND" ? 120 : null, waitingSince: ["PENDING_INTERNAL", "WAITING_CUSTOMER"].includes(definition.status) ? occurredAt : null, lastMessageAt: occurredAt, openedAt: new Date(occurredAt.getTime() - 300_000), resolvedAt: definition.status === "RESOLVED" ? occurredAt : null, createdByActorId: actor.id, updatedByActorId: actor.id },
      });
      await tx.conversationParticipant.upsert({
        where: { id: participantId },
        update: {},
        create: { id: participantId, workspaceId: workspace.id, conversationId: conversation.id, role: "CONTACT", contactId: lead.contactId, contactPointId: lead.contact.points[0].id, identifierKey: hash(`seed:${lead.contact.points[0].normalizedValue}`), externalAddressMasked: `${lead.contact.points[0].normalizedValue.slice(0, 4)}••••${lead.contact.points[0].normalizedValue.slice(-4)}`, activeFrom: conversation.openedAt },
      });
      await tx.message.upsert({
        where: { id: messageId },
        update: {},
        create: { id: messageId, workspaceId: workspace.id, conversationId: conversation.id, senderActorId: actor.id, senderParticipantId: definition.direction === "INBOUND" ? participantId : null, direction: definition.direction, status: definition.messageStatus, type: "TEXT", body: definition.message, bodyHash: hash(definition.message), providerKey: "LOCAL_SIMULATOR", externalMessageId: `seed:${definition.key}`, idempotencyKey: `seed:${SEED_NAMESPACE}:${definition.key}`, clientCorrelationId: `seed:${definition.key}`, isSimulated: true, simulationLabel: "Cenário fictício e determinístico da CRM-43.", occurredAt, sentAt: definition.direction === "OUTBOUND" ? occurredAt : null, receivedAt: definition.direction === "INBOUND" ? occurredAt : null },
      });
      await tx.messageStatusEvent.upsert({
        where: { id: stableId(`status:${definition.key}:1`) },
        update: {},
        create: { id: stableId(`status:${definition.key}:1`), workspaceId: workspace.id, messageId, status: definition.messageStatus, sequence: 1, source: "LOCAL_SIMULATOR", providerReported: true, providerKey: "LOCAL_SIMULATOR", externalEventId: `seed:${definition.key}:status`, providerOccurredAt: occurredAt, ingestedAt: occurredAt, reasonCode: "DEMO_SCENARIO", actorId: actor.id },
      });
      await tx.conversationAssignmentHistory.upsert({
        where: { id: stableId(`assignment:${definition.key}:1`) },
        update: {},
        create: { id: stableId(`assignment:${definition.key}:1`), workspaceId: workspace.id, conversationId, newOwnerMemberId: ownerMemberId, newQueueId: queueId, reason: "Responsabilidade explícita do cenário demonstrativo CRM-43.", actorId: actor.id, occurredAt: conversation.openedAt },
      });
      created += 1;
    }
    const unknownConversationId = stableId("conversation:unknown");
    const unknownMessageId = stableId("message:unknown");
    await tx.conversation.upsert({ where: { id: unknownConversationId }, update: {}, create: { id: unknownConversationId, workspaceId: workspace.id, connectionId: connection.id, queueId: queue.id, channel: "INTERNAL_SIMULATOR", status: "PENDING_INTERNAL", subject: "Contato ainda não identificado", priority: "MEDIUM", externalThreadId: "seed:unknown", unreadCount: 1, firstInboundAt: new Date(now.getTime() - 6 * 60_000), waitingSince: new Date(now.getTime() - 6 * 60_000), lastMessageAt: new Date(now.getTime() - 6 * 60_000), openedAt: new Date(now.getTime() - 6 * 60_000), createdByActorId: actor.id, updatedByActorId: actor.id } });
    await tx.message.upsert({ where: { id: unknownMessageId }, update: {}, create: { id: unknownMessageId, workspaceId: workspace.id, conversationId: unknownConversationId, senderActorId: actor.id, direction: "INBOUND", status: "RECEIVED", body: "Olá, ainda não preenchi o formulário.", bodyHash: hash("Olá, ainda não preenchi o formulário."), providerKey: "LOCAL_SIMULATOR", externalMessageId: "seed:unknown", idempotencyKey: `seed:${SEED_NAMESPACE}:unknown`, clientCorrelationId: "seed:unknown", isSimulated: true, simulationLabel: "Contato fictício aguardando revisão de identidade.", occurredAt: new Date(now.getTime() - 6 * 60_000), receivedAt: new Date(now.getTime() - 6 * 60_000) } });
    await tx.messageStatusEvent.upsert({ where: { id: stableId("status:unknown:1") }, update: {}, create: { id: stableId("status:unknown:1"), workspaceId: workspace.id, messageId: unknownMessageId, status: "RECEIVED", sequence: 1, source: "LOCAL_SIMULATOR", providerReported: true, providerKey: "LOCAL_SIMULATOR", externalEventId: "seed:unknown:status", providerOccurredAt: new Date(now.getTime() - 6 * 60_000), ingestedAt: new Date(now.getTime() - 6 * 60_000), actorId: actor.id } });
    await tx.messageIdentityReview.upsert({ where: { id: stableId("review:unknown") }, update: {}, create: { id: stableId("review:unknown"), workspaceId: workspace.id, conversationId: unknownConversationId, messageId: unknownMessageId, reason: "CONTACT_NOT_FOUND", normalizedAddressHash: hash("seed:unknown-address"), channel: "INTERNAL_SIMULATOR", evidence: { leadCreated: false, intakeRequiredForCreation: true }, createdByActorId: actor.id } });
    const emailDefinitions = [
      { key: "email-inbound", direction: "INBOUND", status: "RECEIVED", subject: "Pedido de informações", body: "Gostaria de entender a proposta.", minutes: 11 },
      { key: "email-delivered", direction: "OUTBOUND", status: "DELIVERED", subject: "Próximos passos", body: "SIMULAÇÃO LOCAL — próximos passos enviados.", minutes: 74 },
      { key: "email-deferred", direction: "OUTBOUND", status: "SOFT_BOUNCE", subject: "Retorno pendente", body: "SIMULAÇÃO LOCAL — entrega temporariamente adiada.", minutes: 190 },
    ] as const;
    let emailCreated = 0;
    for (const [index, definition] of emailDefinitions.entries()) {
      const lead = emailLeads[index];
      const point = lead?.contact?.points[0];
      if (!lead?.contactId || !point) continue;
      const occurredAt = new Date(now.getTime() - definition.minutes * 60_000);
      const conversationId = stableId(`conversation:${definition.key}`);
      const messageId = stableId(`message:${definition.key}`);
      const emailMessageId = stableId(`email-message:${definition.key}`);
      const conversation = await tx.conversation.upsert({ where: { id: conversationId }, update: {}, create: { id: conversationId, workspaceId: workspace.id, contactId: lead.contactId, contactPointId: point.id, accountId: lead.accountId, leadId: lead.id, connectionId: emailConnection.id, assigneeMemberId: lead.ownerMemberId, queueId: lead.ownerMemberId ? null : lead.queueId ?? queue.id, channel: "EMAIL", status: definition.direction === "INBOUND" ? "PENDING_INTERNAL" : "WAITING_CUSTOMER", subject: definition.subject, priority: lead.priority, externalThreadId: `email-seed:${definition.key}`, unreadCount: definition.direction === "INBOUND" ? 1 : 0, firstInboundAt: definition.direction === "INBOUND" ? occurredAt : new Date(occurredAt.getTime() - 120_000), firstHumanResponseAt: definition.direction === "OUTBOUND" ? occurredAt : null, firstResponseSeconds: definition.direction === "OUTBOUND" ? 120 : null, waitingSince: occurredAt, lastMessageAt: occurredAt, openedAt: new Date(occurredAt.getTime() - 300_000), createdByActorId: actor.id, updatedByActorId: actor.id } });
      await tx.message.upsert({ where: { id: messageId }, update: {}, create: { id: messageId, workspaceId: workspace.id, conversationId: conversation.id, senderActorId: actor.id, direction: definition.direction, status: definition.status, type: "TEXT", subject: definition.subject, body: definition.body, bodyHash: hash(definition.body), providerKey: "EMAIL_LOCAL_SINK", externalMessageId: `email-seed:${definition.key}`, idempotencyKey: `seed:${SEED_NAMESPACE}:${definition.key}`, clientCorrelationId: `email-seed:${definition.key}`, isSimulated: true, simulationLabel: "Cenário fictício de e-mail no sink local; nenhum envio externo ocorreu.", occurredAt, sentAt: definition.direction === "OUTBOUND" ? occurredAt : null, receivedAt: definition.direction === "INBOUND" ? occurredAt : null, deliveredAt: definition.status === "DELIVERED" ? occurredAt : null, lastProviderStatusAt: definition.direction === "OUTBOUND" ? occurredAt : null } });
      await tx.emailMessageProfile.upsert({ where: { workspaceId_messageId: { workspaceId: workspace.id, messageId } }, update: {}, create: { id: emailMessageId, workspaceId: workspace.id, profileId: emailProfile.id, messageId, messageIdHeader: `<${messageId}@${emailProfile.domain}>`, textBodyHash: hash(definition.body), providerMessageId: `local-email-seed-${index + 1}` } });
      const recipientId = stableId(`email-recipient:${definition.key}`);
      await tx.emailRecipient.upsert({ where: { id: recipientId }, update: {}, create: { id: recipientId, workspaceId: workspace.id, emailMessageId, type: "TO", normalizedAddress: definition.direction === "INBOUND" ? emailProfile.senderAddressNormalized : point.normalizedValue, maskedAddress: (definition.direction === "INBOUND" ? emailProfile.senderAddressNormalized : point.normalizedValue).replace(/^(.{1,2}).*(@.*)$/, "$1•••$2") } });
      await tx.messageStatusEvent.upsert({ where: { id: stableId(`status:${definition.key}:1`) }, update: {}, create: { id: stableId(`status:${definition.key}:1`), workspaceId: workspace.id, messageId, status: definition.status, sequence: 1, source: "LOCAL_SIMULATOR", providerReported: true, providerKey: "EMAIL_LOCAL_SINK", externalEventId: `email-seed:${definition.key}:status`, providerOccurredAt: occurredAt, ingestedAt: occurredAt, reasonCode: "DEMO_EMAIL_SCENARIO", actorId: actor.id } });
      emailCreated += 1;
    }
    return { workspaceId: workspace.id, conversations: created + emailCreated + 1, templates: 2, emailConversations: emailCreated, namespace: SEED_NAMESPACE };
  }, { isolationLevel: "Serializable" });
}
