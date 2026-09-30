import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { type CampaignCommand, type CreateCampaignInput } from "@/modules/campaigns/domain/outbound-campaign-contracts";
import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { getDatabaseClient } from "@/shared/core/database/client";

const MAX_ATTEMPTS = 3;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function maskAddress(value: string): string {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local?.slice(0, 2) ?? "**"}***@${domain ?? "***"}`;
  }
  return value.length > 4 ? `${"*".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}` : "****";
}

function renderTemplate(template: string, lead: { fullName: string; city: string | null; stateCode: string | null }): string {
  return template.replaceAll("{{nome}}", lead.fullName).replaceAll("{{cidade}}", lead.city ?? "").replaceAll("{{uf}}", lead.stateCode ?? "");
}

function minuteInZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

type Options = Readonly<{ database: PrismaClient; now?: () => Date }>;

export function createOutboundCampaignService(options: Options) {
  const now = options.now ?? (() => new Date());
  const authorization = createAuthorizationService({ database: options.database });
  const resource = (context: AuthenticatedContext, campaignId?: string) => ({ workspaceId: context.workspaceId, resourceType: "OutboundCampaign", ...(campaignId ? { resourceId: campaignId } : {}) });

  async function assert(context: AuthenticatedContext, permission: PermissionKey, campaignId?: string) {
    await authorization.assertAuthorized(context, permission, resource(context, campaignId));
  }

  async function getCampaign(context: AuthenticatedContext, campaignId: string) {
    const campaign = await options.database.outboundCampaign.findFirst({ where: { id: campaignId, workspaceId: context.workspaceId } });
    if (!campaign) fail("Campanha de comunicação não encontrada.", "NOT_FOUND", 404);
    return campaign;
  }

  async function create(context: AuthenticatedContext, input: CreateCampaignInput) {
    await assert(context, PermissionKeys.OUTBOUND_CAMPAIGNS_MANAGE);
    if (input.providerMode !== "LOCAL_SIMULATOR") fail("Nenhum fornecedor externo foi autorizado para campanhas. Use o simulador local.", "EXTERNAL_PROVIDER_NOT_AUTHORIZED");
    const campaign = await options.database.outboundCampaign.create({ data: {
      workspaceId: context.workspaceId, name: input.name, channel: input.channel, providerMode: "LOCAL_SIMULATOR", purposeKey: input.purposeKey,
      templateBody: input.templateBody, segmentDefinition: json(input.segment), postActions: json(input.postActions), windowStartMinute: input.windowStartMinute,
      windowEndMinute: input.windowEndMinute, timeZone: input.timeZone, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      maxRecipients: input.maxRecipients, unitCostCents: input.unitCostCents, createdByActorId: context.actorId, updatedByActorId: context.actorId,
    } });
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "outbound_campaign.created", entityType: "OutboundCampaign", entityId: campaign.id, changes: json({ channel: campaign.channel, providerMode: campaign.providerMode, separateFromMediaAcquisition: true, externalEgress: false }) } });
    return { ...campaign, estimatedCostCents: campaign.estimatedCostCents.toString() };
  }

  async function preview(context: AuthenticatedContext, campaignId: string) {
    await assert(context, PermissionKeys.OUTBOUND_CAMPAIGNS_MANAGE, campaignId);
    const campaign = await getCampaign(context, campaignId);
    if (!["DRAFT", "PREVIEWED"].includes(campaign.status)) fail("Somente rascunhos podem gerar uma nova prévia.", "INVALID_CAMPAIGN_STATE");
    const segment = campaign.segmentDefinition as unknown as CreateCampaignInput["segment"];
    const channelType: "PHONE" | "EMAIL" = campaign.channel === "WHATSAPP" || campaign.channel === "SMS" || campaign.channel === "FLASH" || campaign.channel === "VOICE" ? "PHONE" : "EMAIL";
    const addressList = segment.csvAddresses.flatMap((item) => {
      if (channelType === "EMAIL") return [item.trim().toLowerCase()];
      const normalized = normalizePhone(item);
      return normalized.success ? [normalized.normalizedPhone] : [];
    });
    const and: Prisma.LeadWhereInput[] = [{ workspaceId: context.workspaceId, deletedAt: null }];
    if (segment.leadIds.length || addressList.length) and.push({ OR: [
      ...(segment.leadIds.length ? [{ id: { in: segment.leadIds } }] : []),
      ...(addressList.length ? [{ contact: { points: { some: { type: channelType, normalizedValue: { in: addressList }, deletedAt: null } } } }] : []),
    ] });
    if (segment.sourceIds.length) and.push({ sourceId: { in: segment.sourceIds } });
    if (segment.tagIds.length) and.push({ tags: { some: { tagId: { in: segment.tagIds }, removedAt: null } } });
    if (segment.offerIds.length) and.push({ opportunities: { some: { offers: { some: { id: { in: segment.offerIds }, deletedAt: null } } } } });
    if (Object.keys(segment.fields).length) and.push(segment.fields as Prisma.LeadWhereInput);
    const leads = await options.database.lead.findMany({
      where: { AND: and }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: campaign.maxRecipients,
      include: { contact: { include: { points: { where: { type: channelType, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } } },
    });
    const overlapLeadIds = new Set((await options.database.outboundCampaignRecipient.findMany({ where: { workspaceId: context.workspaceId, campaignId: { not: campaign.id }, campaign: { status: "RUNNING" }, leadId: { in: leads.map((lead) => lead.id) }, status: { in: ["QUEUED", "PROCESSING", "ACCEPTED", "RETRY_PENDING"] } }, select: { leadId: true } })).map((item) => item.leadId));
    const consentStates = await options.database.consentState.findMany({ where: { workspaceId: context.workspaceId, contactId: { in: leads.flatMap((lead) => lead.contactId ? [lead.contactId] : []) }, channel: campaign.channel === "WHATSAPP" ? "WHATSAPP" : campaign.channel === "VOICE" ? "PHONE" : "SMS", state: { in: ["DENIED", "REVOKED", "OPTED_OUT"] } }, select: { contactId: true } });
    const optedOut = new Set(consentStates.map((item) => item.contactId));
    const rows = leads.map((lead) => {
      const point = lead.contact?.points[0] ?? null;
      const suppressionReason = !point ? "NO_CONTACT_POINT" : point.doNotContact || lead.contactPreference === "DO_NOT_CONTACT" ? "DO_NOT_CONTACT" : lead.contactId && optedOut.has(lead.contactId) ? "OPT_OUT" : null;
      const overlapReason = lead.awaitingHumanResponse ? "ACTIVE_AGENT_CONVERSATION" : overlapLeadIds.has(lead.id) ? "ACTIVE_CAMPAIGN" : null;
      return { lead, point, suppressionReason, overlapReason, status: suppressionReason ? "SUPPRESSED" : overlapReason ? "OVERLAP_BLOCKED" : "PREVIEWED" };
    });
    const snapshotRows = rows.map(({ lead, point, suppressionReason, overlapReason, status }) => ({ leadId: lead.id, contactId: lead.contactId, contactPointId: point?.id ?? null, address: point?.normalizedValue ?? "missing", body: renderTemplate(campaign.templateBody, lead), status, suppressionReason, overlapReason })).sort((a, b) => a.leadId.localeCompare(b.leadId));
    const snapshotHash = hash({ campaignId: campaign.id, channel: campaign.channel, purposeKey: campaign.purposeKey, templateBody: campaign.templateBody, postActions: campaign.postActions, rows: snapshotRows });
    await options.database.$transaction(async (tx) => {
      await tx.outboundCampaignAttempt.deleteMany({ where: { workspaceId: context.workspaceId, recipient: { campaignId: campaign.id } } });
      await tx.outboundCampaignRecipient.deleteMany({ where: { workspaceId: context.workspaceId, campaignId: campaign.id } });
      if (snapshotRows.length) await tx.outboundCampaignRecipient.createMany({ data: snapshotRows.map((row) => ({ workspaceId: context.workspaceId, campaignId: campaign.id, leadId: row.leadId, contactId: row.contactId, contactPointId: row.contactPointId, addressSnapshot: row.address, templateSnapshot: row.body, status: row.status, suppressionReason: row.suppressionReason, overlapReason: row.overlapReason, idempotencyKey: `campaign:${campaign.id}:lead:${row.leadId}` })) });
      await tx.outboundCampaign.update({ where: { id: campaign.id }, data: { status: "PREVIEWED", snapshotHash, previewedAt: now(), estimatedVolume: snapshotRows.filter((row) => row.status === "PREVIEWED").length, estimatedCostCents: BigInt(snapshotRows.filter((row) => row.status === "PREVIEWED").length * campaign.unitCostCents), updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "outbound_campaign.preview_frozen", entityType: "OutboundCampaign", entityId: campaign.id, changes: json({ snapshotHash, total: snapshotRows.length, eligible: snapshotRows.filter((row) => row.status === "PREVIEWED").length, suppressed: snapshotRows.filter((row) => row.status === "SUPPRESSED").length, overlapBlocked: snapshotRows.filter((row) => row.status === "OVERLAP_BLOCKED").length }) } });
    });
    return { campaignId: campaign.id, snapshotHash, total: snapshotRows.length, eligible: snapshotRows.filter((row) => row.status === "PREVIEWED").length, sample: snapshotRows.slice(0, 10).map((row) => ({ leadId: row.leadId, address: maskAddress(row.address), status: row.status, suppressionReason: row.suppressionReason, overlapReason: row.overlapReason })) };
  }

  async function approve(context: AuthenticatedContext, campaignId: string, expectedSnapshotHash: string, reason: string) {
    await assert(context, PermissionKeys.OUTBOUND_CAMPAIGNS_APPROVE, campaignId);
    const campaign = await getCampaign(context, campaignId);
    if (campaign.status !== "PREVIEWED" || campaign.snapshotHash !== expectedSnapshotHash) fail("A prévia mudou; gere e aprove o público novamente.", "SNAPSHOT_MISMATCH");
    const updated = await options.database.outboundCampaign.update({ where: { id: campaign.id }, data: { status: "APPROVED", approvedAt: now(), approvedByActorId: context.actorId, updatedByActorId: context.actorId } });
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "outbound_campaign.approved", entityType: "OutboundCampaign", entityId: campaign.id, reason, changes: json({ snapshotHash: expectedSnapshotHash, postActions: campaign.postActions, estimatedVolume: campaign.estimatedVolume, estimatedCostCents: campaign.estimatedCostCents.toString() }) } });
    return { ...updated, estimatedCostCents: updated.estimatedCostCents.toString() };
  }

  async function start(context: AuthenticatedContext, campaignId: string) {
    await assert(context, PermissionKeys.OUTBOUND_CAMPAIGNS_EXECUTE, campaignId);
    const campaign = await getCampaign(context, campaignId);
    if (campaign.providerMode !== "LOCAL_SIMULATOR") fail("Fornecedor externo não autorizado; execução bloqueada.", "EXTERNAL_PROVIDER_NOT_AUTHORIZED");
    if (campaign.status !== "APPROVED" || !campaign.snapshotHash) fail("A campanha precisa de prévia congelada e aprovação.", "CAMPAIGN_NOT_APPROVED");
    const frozen = await options.database.outboundCampaignRecipient.findMany({ where: { workspaceId: context.workspaceId, campaignId }, orderBy: { leadId: "asc" } });
    const snapshotRows = frozen.map((row) => ({ leadId: row.leadId, contactId: row.contactId, contactPointId: row.contactPointId, address: row.addressSnapshot, body: row.templateSnapshot, status: row.status, suppressionReason: row.suppressionReason, overlapReason: row.overlapReason }));
    const currentHash = hash({ campaignId: campaign.id, channel: campaign.channel, purposeKey: campaign.purposeKey, templateBody: campaign.templateBody, postActions: campaign.postActions, rows: snapshotRows });
    if (currentHash !== campaign.snapshotHash) fail("O público congelado foi alterado; execução bloqueada.", "SNAPSHOT_MISMATCH");
    await options.database.$transaction(async (tx) => {
      await tx.outboundCampaignRecipient.updateMany({ where: { workspaceId: context.workspaceId, campaignId, status: "PREVIEWED" }, data: { status: "QUEUED", nextAttemptAt: now() } });
      const eligible = frozen.filter((row) => row.status === "PREVIEWED");
      if (eligible.length) await tx.job.createMany({ data: eligible.map((row) => ({ workspaceId: context.workspaceId, type: "OUTBOUND_CAMPAIGN", idempotencyKey: `outbound-campaign-job:${campaign.id}:${row.id}`, runAt: campaign.scheduledAt ?? now(), maxAttempts: MAX_ATTEMPTS, payload: json({ campaignId: campaign.id, recipientId: row.id, snapshotHash: campaign.snapshotHash }), createdByActorId: context.actorId, updatedByActorId: context.actorId })), skipDuplicates: true });
      await tx.outboundCampaign.update({ where: { id: campaignId }, data: { status: "RUNNING", startedAt: now(), updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "outbound_campaign.execution_started", entityType: "OutboundCampaign", entityId: campaign.id, changes: json({ snapshotHash: campaign.snapshotHash, recipientIds: eligible.map((row) => row.id), queuedJobs: eligible.length, externalEgress: false }) } });
    });
    return { campaignId, status: "RUNNING", externalEgress: false, snapshotHash: campaign.snapshotHash };
  }

  async function optOutReason(recipient: { contactId: string | null; contactPointId: string | null }, campaign: Awaited<ReturnType<typeof getCampaign>>) {
    if (!recipient.contactId) return "NO_CONTACT";
    const point = recipient.contactPointId ? await options.database.contactPoint.findFirst({ where: { id: recipient.contactPointId, workspaceId: campaign.workspaceId, deletedAt: null } }) : null;
    if (!point || point.doNotContact) return "DO_NOT_CONTACT";
    const denied = await options.database.consentState.findFirst({ where: { workspaceId: campaign.workspaceId, contactId: recipient.contactId, channel: campaign.channel === "WHATSAPP" ? "WHATSAPP" : campaign.channel === "VOICE" ? "PHONE" : "SMS", state: { in: ["DENIED", "REVOKED", "OPTED_OUT"] } }, orderBy: { effectiveFrom: "desc" } });
    return denied ? "OPT_OUT" : null;
  }

  async function applyPostActions(tx: Prisma.TransactionClient, context: AuthenticatedContext, campaign: Awaited<ReturnType<typeof getCampaign>>, recipient: { id: string; leadId: string }) {
    const actions = campaign.postActions as unknown as CreateCampaignInput["postActions"];
    for (const tagId of actions.tagIds) {
      const existing = await tx.leadTag.findFirst({ where: { workspaceId: context.workspaceId, leadId: recipient.leadId, tagId, removedAt: null } });
      if (!existing) await tx.leadTag.create({ data: { workspaceId: context.workspaceId, leadId: recipient.leadId, tagId, createdByActorId: context.actorId } });
    }
    const marker = `[campaign:${campaign.id}:recipient:${recipient.id}]`;
    const lead = await tx.lead.findFirstOrThrow({ where: { id: recipient.leadId, workspaceId: context.workspaceId } });
    if (actions.assignMemberId && lead.ownerMemberId !== actions.assignMemberId) await tx.lead.update({ where: { id: lead.id }, data: { ownerMemberId: actions.assignMemberId, updatedByActorId: context.actorId } });
    if (actions.taskTitle && !(await tx.task.findFirst({ where: { workspaceId: context.workspaceId, leadId: lead.id, description: marker } }))) await tx.task.create({ data: { workspaceId: context.workspaceId, leadId: lead.id, assigneeMemberId: actions.assignMemberId ?? lead.ownerMemberId, queueId: lead.ownerMemberId ? null : lead.queueId, title: actions.taskTitle, description: marker, kind: "FOLLOW_UP", dueAt: new Date(now().getTime() + 86_400_000), createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    if (actions.createOpportunityName && !(await tx.opportunity.findFirst({ where: { workspaceId: context.workspaceId, leadId: lead.id, name: `${actions.createOpportunityName} ${marker}` } }))) {
      const pipeline = await tx.pipeline.findFirst({ where: { workspaceId: context.workspaceId, entityType: "OPPORTUNITY", deletedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" }, take: 1 } } });
      const ownerMemberId = actions.assignMemberId ?? lead.ownerMemberId;
      if (pipeline?.stages[0] && ownerMemberId) await tx.opportunity.create({ data: { workspaceId: context.workspaceId, leadId: lead.id, accountId: lead.accountId, pipelineId: pipeline.id, currentStageId: pipeline.stages[0].id, ownerMemberId, name: `${actions.createOpportunityName} ${marker}`, amountCents: 0n, probabilityBps: 0, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    }
  }

  async function processNext(context: AuthenticatedContext, campaignId: string, scenario: "ACCEPT" | "TRANSIENT_FAILURE" | "PERMANENT_FAILURE") {
    await assert(context, PermissionKeys.OUTBOUND_CAMPAIGNS_EXECUTE, campaignId);
    const campaign = await getCampaign(context, campaignId);
    if (campaign.status !== "RUNNING" || campaign.providerMode !== "LOCAL_SIMULATOR") fail("A fila local não está disponível neste estado.", "INVALID_CAMPAIGN_STATE");
    const jobs = await options.database.job.findMany({ where: { workspaceId: context.workspaceId, type: "OUTBOUND_CAMPAIGN", status: "PENDING", runAt: { lte: now() }, payload: { path: ["campaignId"], equals: campaignId } }, orderBy: [{ priority: "desc" }, { runAt: "asc" }, { createdAt: "asc" }], take: 5 });
    let claimed: (typeof jobs)[number] | null = null;
    for (const candidate of jobs) {
      const result = await options.database.job.updateMany({ where: { id: candidate.id, workspaceId: context.workspaceId, status: "PENDING" }, data: { status: "RUNNING", lockedAt: now(), lockedBy: `campaign:${context.actorId}`, lockExpiresAt: new Date(now().getTime() + 60_000), attempts: { increment: 1 }, lastAttemptAt: now(), updatedByActorId: context.actorId } });
      if (result.count === 1) { claimed = candidate; break; }
    }
    if (!claimed) {
      const pending = await options.database.job.count({ where: { workspaceId: context.workspaceId, type: "OUTBOUND_CAMPAIGN", status: { in: ["PENDING", "RUNNING"] }, payload: { path: ["campaignId"], equals: campaignId } } });
      if (pending === 0) await options.database.outboundCampaign.update({ where: { id: campaignId }, data: { status: "COMPLETED", completedAt: now(), updatedByActorId: context.actorId } });
      return { status: pending === 0 ? "COMPLETED" : "IDLE", externalEgress: false };
    }
    const currentMinute = minuteInZone(now(), campaign.timeZone);
    if (currentMinute < campaign.windowStartMinute || currentMinute >= campaign.windowEndMinute) {
      await options.database.job.update({ where: { id: claimed.id }, data: { status: "PENDING", lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: context.actorId } });
      fail("A execução está fora da janela aprovada.", "OUTSIDE_SEND_WINDOW");
    }
    const payload = claimed.payload as { recipientId?: string; snapshotHash?: string };
    if (!payload.recipientId || payload.snapshotHash !== campaign.snapshotHash) {
      await options.database.job.update({ where: { id: claimed.id }, data: { status: "FAILED", errorCode: "INVALID_FROZEN_PAYLOAD", lastError: "Payload da fila diverge da aprovação.", finishedAt: now(), updatedByActorId: context.actorId } });
      fail("Payload da fila diverge do público aprovado.", "SNAPSHOT_MISMATCH");
    }
    const recipient = await options.database.outboundCampaignRecipient.findFirst({ where: { id: payload.recipientId, workspaceId: context.workspaceId, campaignId, status: { in: ["QUEUED", "RETRY_PENDING"] } } });
    if (!recipient) {
      await options.database.job.update({ where: { id: claimed.id }, data: { status: "SUCCEEDED", result: json({ outcome: "ALREADY_TERMINAL" }), finishedAt: now(), updatedByActorId: context.actorId } });
      return { status: "IDEMPOTENT", externalEgress: false };
    }
    const suppression = await optOutReason(recipient, campaign);
    if (suppression) {
      await options.database.outboundCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "SUPPRESSED", suppressionReason: suppression, nextAttemptAt: null } });
      await options.database.job.update({ where: { id: claimed.id }, data: { status: "SUCCEEDED", result: json({ outcome: "SUPPRESSED", reason: suppression }), finishedAt: now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: context.actorId } });
      return { status: "SUPPRESSED", recipientId: recipient.id, reason: suppression, externalEgress: false };
    }
    const [lead, competing, activeCadence] = await Promise.all([
      options.database.lead.findFirst({ where: { id: recipient.leadId, workspaceId: context.workspaceId }, select: { awaitingHumanResponse: true } }),
      options.database.outboundCampaignRecipient.findFirst({ where: { workspaceId: context.workspaceId, campaignId: { not: campaign.id }, campaign: { status: "RUNNING" }, leadId: recipient.leadId, status: { in: ["QUEUED", "PROCESSING", "ACCEPTED", "RETRY_PENDING"] } }, select: { id: true } }),
      options.database.automationRun.findFirst({ where: { workspaceId: context.workspaceId, leadId: recipient.leadId, status: { in: ["PENDING", "RUNNING"] }, actionConfigSnapshot: { path: ["category"], equals: "OUTREACH_CADENCE" } }, select: { id: true } }),
    ]);
    if (lead?.awaitingHumanResponse || competing || activeCadence) {
      const reason = lead?.awaitingHumanResponse ? "ACTIVE_AGENT_CONVERSATION" : activeCadence ? "ACTIVE_CADENCE" : "ACTIVE_CAMPAIGN";
      await options.database.outboundCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "OVERLAP_BLOCKED", overlapReason: reason, nextAttemptAt: null } });
      await options.database.job.update({ where: { id: claimed.id }, data: { status: "SUCCEEDED", result: json({ outcome: "OVERLAP_BLOCKED", reason }), finishedAt: now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: context.actorId } });
      return { status: "OVERLAP_BLOCKED", recipientId: recipient.id, reason, externalEgress: false };
    }
    const attemptNumber = recipient.attemptCount + 1;
    const providerReceiptId = scenario === "ACCEPT" ? `local:${campaign.id}:${recipient.id}` : null;
    const nextStatus = scenario === "ACCEPT" ? "ACCEPTED" : scenario === "TRANSIENT_FAILURE" && attemptNumber < MAX_ATTEMPTS ? "RETRY_PENDING" : "FAILED";
    await options.database.$transaction(async (tx) => {
      await tx.outboundCampaignAttempt.create({ data: { workspaceId: context.workspaceId, recipientId: recipient.id, attemptNumber, status: nextStatus, providerReceiptId, errorCode: scenario === "ACCEPT" ? null : scenario, startedAt: now(), finishedAt: now(), simulated: true, externalEgress: false } });
      await tx.outboundCampaignRecipient.update({ where: { id: recipient.id }, data: { status: nextStatus, attemptCount: attemptNumber, providerReceiptId, acceptedAt: scenario === "ACCEPT" ? now() : null, failedAt: nextStatus === "FAILED" ? now() : null, lastError: scenario === "ACCEPT" ? null : scenario, costCents: scenario === "ACCEPT" ? campaign.unitCostCents : 0, nextAttemptAt: nextStatus === "RETRY_PENDING" ? new Date(now().getTime() + 2 ** attemptNumber * 60_000) : null } });
      await tx.job.update({ where: { id: claimed.id }, data: nextStatus === "RETRY_PENDING" ? { status: "PENDING", runAt: new Date(now().getTime() + 2 ** attemptNumber * 60_000), errorCode: scenario, lastError: scenario, lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: context.actorId } : { status: nextStatus === "FAILED" ? "FAILED" : "SUCCEEDED", result: json({ outcome: nextStatus, recipientId: recipient.id, providerReceiptId }), errorCode: nextStatus === "FAILED" ? scenario : null, lastError: nextStatus === "FAILED" ? scenario : null, finishedAt: now(), lockedAt: null, lockedBy: null, lockExpiresAt: null, updatedByActorId: context.actorId } });
      if (scenario === "ACCEPT") await applyPostActions(tx, context, campaign, recipient);
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "outbound_campaign.recipient_processed", entityType: "OutboundCampaignRecipient", entityId: recipient.id, changes: json({ attemptNumber, status: nextStatus, simulated: true, externalEgress: false }) } });
    });
    return { status: nextStatus, recipientId: recipient.id, attemptNumber, providerReceiptId, externalEgress: false };
  }

  async function cancel(context: AuthenticatedContext, campaignId: string, reason: string) {
    await assert(context, PermissionKeys.OUTBOUND_CAMPAIGNS_EXECUTE, campaignId);
    const campaign = await getCampaign(context, campaignId);
    if (["COMPLETED", "CANCELLED"].includes(campaign.status)) fail("A campanha já foi encerrada.", "INVALID_CAMPAIGN_STATE");
    await options.database.$transaction([
      options.database.outboundCampaignRecipient.updateMany({ where: { workspaceId: context.workspaceId, campaignId, status: { in: ["PREVIEWED", "QUEUED", "RETRY_PENDING"] } }, data: { status: "CANCELLED", nextAttemptAt: null } }),
      options.database.job.updateMany({ where: { workspaceId: context.workspaceId, type: "OUTBOUND_CAMPAIGN", status: "PENDING", payload: { path: ["campaignId"], equals: campaignId } }, data: { status: "CANCELLED", cancelRequestedAt: now(), cancelledAt: now(), finishedAt: now(), updatedByActorId: context.actorId } }),
      options.database.outboundCampaign.update({ where: { id: campaignId }, data: { status: "CANCELLED", cancelledAt: now(), cancelledByActorId: context.actorId, cancellationReason: reason, updatedByActorId: context.actorId } }),
      options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "outbound_campaign.cancelled", entityType: "OutboundCampaign", entityId: campaignId, reason } }),
    ]);
    return { campaignId, status: "CANCELLED" };
  }

  async function recordStatus(context: AuthenticatedContext, campaignId: string, recipientId: string, status: "DELIVERED" | "RESPONDED" | "FAILED", externalEventId: string) {
    await assert(context, PermissionKeys.OUTBOUND_CAMPAIGNS_EXECUTE, campaignId);
    const campaign = await getCampaign(context, campaignId);
    if (campaign.providerMode !== "LOCAL_SIMULATOR") fail("Callback externo bloqueado sem fornecedor autorizado.", "EXTERNAL_PROVIDER_NOT_AUTHORIZED");
    const recipient = await options.database.outboundCampaignRecipient.findFirst({ where: { id: recipientId, campaignId, workspaceId: context.workspaceId } });
    if (!recipient) fail("Destinatário não encontrado.", "NOT_FOUND", 404);
    const already = await options.database.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: "outbound_campaign.status_recorded", requestId: externalEventId } });
    if (already) return { recipientId, status: recipient.status, idempotent: true };
    const updated = await options.database.outboundCampaignRecipient.update({ where: { id: recipient.id }, data: { status, deliveredAt: status === "DELIVERED" ? now() : recipient.deliveredAt, respondedAt: status === "RESPONDED" ? now() : null, failedAt: status === "FAILED" ? now() : null } });
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "outbound_campaign.status_recorded", entityType: "OutboundCampaignRecipient", entityId: recipient.id, requestId: externalEventId, changes: json({ status }) } });
    return { recipientId, status: updated.status, idempotent: false };
  }

  async function screen(context: AuthenticatedContext, campaignId?: string) {
    await assert(context, PermissionKeys.OUTBOUND_CAMPAIGNS_READ, campaignId);
    const campaigns = await options.database.outboundCampaign.findMany({ where: { workspaceId: context.workspaceId, ...(campaignId ? { id: campaignId } : {}) }, orderBy: { createdAt: "desc" }, take: campaignId ? 1 : 50, include: { recipients: { orderBy: { createdAt: "asc" }, take: campaignId ? 500 : 100 } } });
    return { module: "OUTBOUND_COMMUNICATION_CAMPAIGNS", mediaAcquisitionSeparate: true, externalProvidersAuthorized: false, externalEgress: false, providerGate: "EXTERNAL_BLOCKED", campaigns: campaigns.map((campaign) => { const counts = Object.fromEntries(Object.entries(campaign.recipients.reduce<Record<string, number>>((result, row) => ({ ...result, [row.status]: (result[row.status] ?? 0) + 1 }), {}))); const terminal = (counts.ACCEPTED ?? 0) + (counts.DELIVERED ?? 0) + (counts.RESPONDED ?? 0) + (counts.FAILED ?? 0) + (counts.SUPPRESSED ?? 0) + (counts.OVERLAP_BLOCKED ?? 0) + (counts.CANCELLED ?? 0); const segment = campaign.segmentDefinition as unknown as CreateCampaignInput["segment"]; return { ...campaign, segmentDefinition: { leadIdCount: segment.leadIds.length, csvAddressCount: segment.csvAddresses.length, sourceIds: segment.sourceIds, tagIds: segment.tagIds, offerIds: segment.offerIds, fields: segment.fields }, estimatedCostCents: campaign.estimatedCostCents.toString(), recipients: campaign.recipients.map((row) => ({ ...row, addressSnapshot: maskAddress(row.addressSnapshot), templateSnapshot: campaignId ? row.templateSnapshot : undefined })), metrics: { eligible: campaign.estimatedVolume, queued: (counts.QUEUED ?? 0) + (counts.PROCESSING ?? 0) + (counts.RETRY_PENDING ?? 0), accepted: counts.ACCEPTED ?? 0, delivered: counts.DELIVERED ?? 0, responded: counts.RESPONDED ?? 0, failed: counts.FAILED ?? 0, suppressed: counts.SUPPRESSED ?? 0, overlapBlocked: counts.OVERLAP_BLOCKED ?? 0, cancelled: counts.CANCELLED ?? 0, costCents: campaign.recipients.reduce((sum, row) => sum + row.costCents, 0), reconciled: campaign.status === "COMPLETED" && terminal === campaign.recipients.length } }; }) };
  }

  async function command(context: AuthenticatedContext, input: CampaignCommand) {
    if (input.action === "CREATE") return create(context, input.campaign);
    if (input.action === "PREVIEW") return preview(context, input.campaignId);
    if (input.action === "APPROVE") return approve(context, input.campaignId, input.expectedSnapshotHash, input.reason);
    if (input.action === "START") return start(context, input.campaignId);
    if (input.action === "PROCESS_NEXT") return processNext(context, input.campaignId, input.scenario);
    if (input.action === "CANCEL") return cancel(context, input.campaignId, input.reason);
    return recordStatus(context, input.campaignId, input.recipientId, input.status, input.externalEventId);
  }

  return Object.freeze({ screen, command, create, preview, approve, start, processNext, cancel, recordStatus });
}

let singleton: ReturnType<typeof createOutboundCampaignService> | undefined;
export function getOutboundCampaignService() {
  singleton ??= createOutboundCampaignService({ database: getDatabaseClient() });
  return singleton;
}
