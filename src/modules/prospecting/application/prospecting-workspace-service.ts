import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { resolveLeadVisibilityScope } from "@/modules/leads/application/lead-list-service";
import { PROSPECTING_EMAIL_TEMPLATE_COUNT } from "@/modules/prospecting/domain/prospecting-email-sequence";
import { getDatabaseClient } from "@/shared/core/database/client";
import { addLocalDays, workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";
import { z } from "zod";

const querySchema = z.object({
  status: z.enum(["RECEIVED", "REVIEW_REQUIRED", "READY", "REJECTED", "PLANNED", "RELEASED"]).optional(),
  role: z.enum(["MAYOR", "COUNCILOR"]).optional(),
  stateCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  activityPage: z.coerce.number().int().positive().default(1),
  emailPage: z.coerce.number().int().positive().default(1),
}).strict();

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "assertAuthorized" | "authorize">;
type CapacityTaskRow = Readonly<{ memberId: string; localDate: Date; realized: bigint; scheduled: bigint }>;

function persistedReconciliationAlerts(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const code = typeof item.code === "string" ? item.code : null;
    const severity = item.severity === "CRITICAL" || item.severity === "ATTENTION" ? item.severity : null;
    const message = typeof item.message === "string" ? item.message : null;
    const action = typeof item.action === "string" ? item.action : null;
    const count = typeof item.count === "number" && Number.isSafeInteger(item.count) && item.count > 0 ? item.count : 1;
    if (!code || !severity || !message || !action) return [];
    return [{ level: severity === "CRITICAL" ? "CRITICAL" : "WARNING", code, message: `${count} ocorrência(s): ${message}`, action }];
  });
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function createProspectingWorkspaceService(options: Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>) {
  async function getScreen(context: AuthenticatedContext, raw: unknown) {
    const query = querySchema.parse(raw);
    const [workspace, manageDecision, sensitiveDecision, visibility] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } }),
      options.authorization.authorize(context, PermissionKeys.OUTBOUND_CAMPAIGNS_MANAGE, { workspaceId: context.workspaceId, resourceType: "AutomationDefinition" }),
      options.authorization.authorize(context, PermissionKeys.CONTACTS_READ, { workspaceId: context.workspaceId, resourceType: "Contact" }),
      resolveLeadVisibilityScope(options.database, options.authorization, context, PermissionKeys.LEADS_READ),
    ]);
    let scopedMemberIds: string[] | null = null;
    if (!manageDecision.allowed && visibility.scope !== "WORKSPACE") {
      if (visibility.scope === "OWN") scopedMemberIds = [context.memberId];
      else scopedMemberIds = (await options.database.teamMember.findMany({
        where: { workspaceId: context.workspaceId, teamId: { in: [...visibility.teamIds] }, deletedAt: null, member: { status: "ACTIVE", deletedAt: null } },
        distinct: ["workspaceMemberId"],
        select: { workspaceMemberId: true },
      })).map((item) => item.workspaceMemberId);
    }
    const scopedReleases = scopedMemberIds === null ? [] : await options.database.prospectRelease.findMany({
      where: { workspaceId: context.workspaceId, plannedMemberId: { in: scopedMemberIds } },
      select: { candidateId: true, leadId: true },
    });
    const scopedCandidateIds = scopedReleases.map((release) => release.candidateId);
    const scopedLeadIds = scopedReleases.flatMap((release) => release.leadId ? [release.leadId] : []);
    const memberScope = scopedMemberIds === null ? {} : { in: scopedMemberIds };
    const candidateScope = scopedMemberIds === null ? {} : { id: { in: scopedCandidateIds } };
    const leadScope = scopedMemberIds === null ? {} : { leadId: { in: scopedLeadIds } };
    const now = options.now();
    const todayLocal = workspaceDateAt(now, workspace.timeZone);
    const today = workspaceDayRange(todayLocal, workspace.timeZone);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const capacityEndLocal = addLocalDays(todayLocal, 29);
    const candidateWhere = {
      workspaceId: context.workspaceId,
      ...candidateScope,
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.stateCode ? { stateCode: query.stateCode } : {}),
    } satisfies Prisma.ProspectCandidateWhereInput;
    const candidateScopeWhere = {
      workspaceId: context.workspaceId,
      ...candidateScope,
    } satisfies Prisma.ProspectCandidateWhereInput;
    const pageSize = 25;

    const [
      settings,
      reconciliationState,
      candidateCounts,
      candidateTotal,
      candidates,
      releases,
      sellers,
      pipeline,
      manualTasks,
      jobCounts,
      recentJobs,
      templates,
      senders,
      cadenceCounts,
      touchedToday,
      releasesToday,
      meetingsThirtyDays,
      lastResearch,
      lastEmailClient,
      overdueJobs,
      overdueD1,
      manualTaskTotal,
      emailJobTotal,
      capacityTaskRows,
      capacityReleases,
      manualCompletionCounts,
      cadenceStopCounts,
      releasesThirtyDays,
      conversationsThirtyDays,
      latestSourceObservation,
    ] = await Promise.all([
      options.database.prospectingSettings.findUnique({ where: { workspaceId: context.workspaceId } }),
      manageDecision.allowed ? options.database.prospectingReconciliationState.findUnique({
        where: { workspaceId: context.workspaceId },
        select: { status: true, findings: true, lastRunAt: true },
      }) : Promise.resolve(null),
      options.database.prospectCandidate.groupBy({ by: ["status"], where: candidateScopeWhere, _count: { _all: true } }),
      options.database.prospectCandidate.count({ where: candidateWhere }),
      options.database.prospectCandidate.findMany({
        where: candidateWhere,
        orderBy: [{ plannedReleaseDate: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, politicianName: true, role: true, municipalityName: true, stateCode: true,
          population: true, phone: true, normalizedEmail: true, phoneScope: true, emailScope: true,
          politicianPhone: true, politicianEmail: true,
          advisorPhone: true, advisorEmail: true, whatsapp: true, whatsappScope: true,
          instagram: true, instagramScope: true, status: true, reviewReasonCode: true, rejectionReasonCode: true,
          mandateVerifiedAt: true, plannedReleaseDate: true, releasedAt: true, leadId: true,
        },
      }),
      options.database.prospectRelease.findMany({
        where: { workspaceId: context.workspaceId, status: { in: ["PLANNED", "CLAIMED", "DEFERRED", "FAILED"] }, plannedMemberId: memberScope },
        orderBy: [{ plannedDate: "asc" }, { id: "asc" }],
        take: 60,
        select: { id: true, candidateId: true, plannedDate: true, plannedMemberId: true, status: true, reasonCode: true },
      }),
      options.database.prospectingSellerConfig.findMany({
        where: { workspaceId: context.workspaceId, memberId: memberScope },
        orderBy: [{ rotationPosition: "asc" }, { memberId: "asc" }],
        select: { id: true, memberId: true, senderProfileId: true, active: true, dailyCapacity: true, reservePercent: true, dailyEmailLimit: true, rotationPosition: true, pausedReason: true },
      }),
      options.database.pipeline.findFirst({
        where: { workspaceId: context.workspaceId, name: "Prospecção Ativa", entityType: "LEAD", deletedAt: null },
        select: { id: true, stages: { where: { deletedAt: null }, orderBy: { position: "asc" }, select: { id: true, stableKey: true, name: true, position: true, type: true, _count: { select: { currentLeads: { where: { deletedAt: null, ownerMemberId: memberScope } } } } } } },
      }),
      options.database.task.findMany({
        where: { workspaceId: context.workspaceId, assigneeMemberId: memberScope, sourceKey: { startsWith: "active-prospecting:" }, kind: { in: ["CALL", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW", "FOLLOW_UP"] }, status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] }, deletedAt: null },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        skip: (query.activityPage - 1) * pageSize,
        take: pageSize,
        select: { id: true, leadId: true, assigneeMemberId: true, title: true, kind: true, status: true, priority: true, dueAt: true, completedAt: true, result: true, lead: { select: { fullName: true, jobTitle: true } } },
      }),
      options.database.prospectingEmailJob.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId, ...leadScope }, _count: { _all: true } }),
      options.database.prospectingEmailJob.findMany({
        where: { workspaceId: context.workspaceId, ...leadScope }, orderBy: [{ scheduledAt: "desc" }, { id: "desc" }], skip: (query.emailPage - 1) * pageSize, take: pageSize,
        select: { id: true, leadId: true, stepKey: true, status: true, scheduledAt: true, expiresAt: true, sentAt: true, attemptCount: true, lastErrorCode: true, senderProfileId: true, templateVersionId: true },
      }),
      options.database.prospectingEmailTemplateVersion.findMany({
        where: { workspaceId: context.workspaceId }, orderBy: [{ stepKey: "asc" }, { version: "desc" }],
        select: { id: true, stepKey: true, version: true, subjectTemplate: true, bodyTemplate: true, allowedVariables: true, published: true, publishedAt: true, contentHash: true },
      }),
      options.database.emailConnectionProfile.findMany({
        where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "asc" },
        select: { id: true, displayName: true, senderAddressNormalized: true, domain: true, operatingMode: true, spfStatus: true, dkimStatus: true, dmarcStatus: true, lastSuccessAt: true, pausedReason: true },
      }),
      options.database.prospectingCadenceInstance.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId, ownerMemberId: memberScope }, _count: { _all: true } }),
      options.database.task.findMany({
        where: { workspaceId: context.workspaceId, assigneeMemberId: memberScope, completedAt: { gte: today.start, lt: today.end }, status: "COMPLETED", kind: { in: ["CALL", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW"] }, sourceKey: { startsWith: "active-prospecting:" }, result: { not: "CHANNEL_UNAVAILABLE" }, deletedAt: null },
        distinct: ["leadId"], select: { leadId: true },
      }),
      options.database.prospectRelease.count({ where: { workspaceId: context.workspaceId, plannedMemberId: memberScope, releasedAt: { gte: today.start, lt: today.end }, status: "RELEASED" } }),
      options.database.meeting.count({ where: { workspaceId: context.workspaceId, lead: { pipeline: { name: "Prospecção Ativa" }, ownerMemberId: memberScope }, createdAt: { gte: thirtyDaysAgo }, deletedAt: null, status: { not: "CANCELLED" } } }),
      options.database.openDotRequestReceipt.findFirst({ where: { workspaceId: context.workspaceId, scope: { in: ["RESEARCH_WRITE", "RESEARCH_REVIEW"] } }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true, clientId: true } }),
      options.database.openDotRequestReceipt.findFirst({ where: { workspaceId: context.workspaceId, scope: { in: ["EMAIL_CLAIM", "EMAIL_RECEIPT", "EMAIL_EVENT_WRITE"] } }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true, clientId: true } }),
      options.database.prospectingEmailJob.count({ where: { workspaceId: context.workspaceId, ...leadScope, status: "SCHEDULED", scheduledAt: { lt: now } } }),
      options.database.prospectingCadenceInstance.count({ where: { workspaceId: context.workspaceId, ownerMemberId: memberScope, status: "PENDING_D1", d1Date: { lt: new Date(`${todayLocal}T00:00:00.000Z`) } } }),
      options.database.task.count({ where: { workspaceId: context.workspaceId, assigneeMemberId: memberScope, sourceKey: { startsWith: "active-prospecting:" }, kind: { in: ["CALL", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW", "FOLLOW_UP"] }, status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] }, deletedAt: null } }),
      options.database.prospectingEmailJob.count({ where: { workspaceId: context.workspaceId, ...leadScope } }),
      options.database.$queryRaw<CapacityTaskRow[]>(Prisma.sql`
        SELECT task."assigneeMemberId" AS "memberId",
               (task."dueAt" AT TIME ZONE ${workspace.timeZone})::date AS "localDate",
               COUNT(DISTINCT task."leadId") FILTER (WHERE task."status"::text = 'COMPLETED' AND COALESCE(task."result", '') <> 'CHANNEL_UNAVAILABLE')::bigint AS realized,
               COUNT(DISTINCT task."leadId") FILTER (WHERE task."status"::text IN ('OPEN', 'IN_PROGRESS'))::bigint AS scheduled
        FROM "tasks" task
        WHERE task."workspaceId" = ${context.workspaceId}::uuid
          AND task."sourceKey" LIKE 'active-prospecting:%'
          ${scopedMemberIds === null
            ? Prisma.empty
            : scopedMemberIds.length === 0
              ? Prisma.sql`AND FALSE`
              : Prisma.sql`AND task."assigneeMemberId" IN (${Prisma.join(scopedMemberIds)})`}
          AND task."kind"::text IN ('CALL', 'INSTAGRAM_MESSAGE', 'INSTAGRAM_FOLLOW')
          AND task."deletedAt" IS NULL
          AND (task."dueAt" AT TIME ZONE ${workspace.timeZone})::date BETWEEN ${todayLocal}::date AND ${capacityEndLocal}::date
        GROUP BY 1, 2
      `),
      options.database.prospectRelease.findMany({
        where: { workspaceId: context.workspaceId, plannedMemberId: memberScope, status: { in: ["PLANNED", "CLAIMED"] }, plannedDate: { gte: new Date(`${todayLocal}T00:00:00.000Z`), lte: new Date(`${capacityEndLocal}T00:00:00.000Z`) } },
        select: { plannedMemberId: true, plannedDate: true },
      }),
      options.database.task.groupBy({
        by: ["kind"],
        where: { workspaceId: context.workspaceId, assigneeMemberId: memberScope, completedAt: { gte: thirtyDaysAgo }, status: "COMPLETED", kind: { in: ["CALL", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW"] }, sourceKey: { startsWith: "active-prospecting:" }, result: { not: "CHANNEL_UNAVAILABLE" }, deletedAt: null },
        _count: { _all: true },
      }),
      options.database.prospectingCadenceInstance.groupBy({ by: ["stopReasonCode"], where: { workspaceId: context.workspaceId, ownerMemberId: memberScope, stoppedAt: { gte: thirtyDaysAgo } }, _count: { _all: true } }),
      options.database.prospectRelease.count({ where: { workspaceId: context.workspaceId, plannedMemberId: memberScope, status: "RELEASED", releasedAt: { gte: thirtyDaysAgo } } }),
      options.database.prospectingCadenceInstance.count({ where: { workspaceId: context.workspaceId, ownerMemberId: memberScope, status: "CONVERSATION_STARTED", stoppedAt: { gte: thirtyDaysAgo } } }),
      options.database.prospectCandidateSource.aggregate({ where: { workspaceId: context.workspaceId, ...(scopedMemberIds === null ? {} : { candidateId: { in: scopedCandidateIds } }) }, _max: { observedAt: true } }),
    ]);

    const candidateSourceCounts = await options.database.prospectCandidateSource.groupBy({
      by: ["candidateId"],
      where: { workspaceId: context.workspaceId, candidateId: { in: candidates.map((candidate) => candidate.id) } },
      _count: { _all: true },
    });

    const memberRows = await options.database.workspaceMember.findMany({
      where: { workspaceId: context.workspaceId, id: { in: sellers.map((seller) => seller.memberId) } },
      select: { id: true, status: true, leadReceivingPausedAt: true, user: { select: { displayName: true, status: true } } },
    });
    const sellerOptions = await options.database.workspaceMember.findMany({
      where: { ...commercialMemberWhere({ workspaceId: context.workspaceId, functions: ["SDR", "CLOSER"] }), id: memberScope },
      orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
      select: { id: true, user: { select: { displayName: true } } },
    });
    const memberById = new Map(memberRows.map((member) => [member.id, member]));
    const candidateCount = (status: string) => candidateCounts.find((row) => row.status === status)?._count._all ?? 0;
    const readyOrPlanned = candidateCount("READY") + candidateCount("PLANNED");
    const dailyNewCapacity = sellers.filter((seller) => seller.active).reduce((sum, seller) => sum + seller.dailyCapacity, 0);
    const coverageDays = dailyNewCapacity > 0 ? Math.floor(readyOrPlanned / dailyNewCapacity) : 0;
    const publishedTemplateKeys = new Set(templates.filter((template) => template.published).map((template) => template.stepKey));
    const senderReady = senders.some((sender) => sender.operatingMode === "EXTERNAL_READY" && sender.spfStatus === "VERIFIED_EXTERNAL" && sender.dkimStatus === "VERIFIED_EXTERNAL" && sender.dmarcStatus === "VERIFIED_EXTERNAL");
    const capacityByKey = new Map(capacityTaskRows.map((row) => [`${row.memberId}:${dateKey(row.localDate)}`, { realized: Number(row.realized), scheduled: Number(row.scheduled), planned: 0 }]));
    for (const release of capacityReleases) {
      if (!release.plannedMemberId) continue;
      const localDate = dateKey(release.plannedDate);
      if (localDate < todayLocal || localDate > capacityEndLocal) continue;
      const key = `${release.plannedMemberId}:${localDate}`;
      const value = capacityByKey.get(key) ?? { realized: 0, scheduled: 0, planned: 0 };
      value.planned += 1;
      capacityByKey.set(key, value);
    }
    const alerts = [
      ...persistedReconciliationAlerts(reconciliationState?.findings),
      ...(coverageDays < (settings?.coverageCriticalDays ?? 5) ? [{ level: "CRITICAL", code: "LOW_STOCK", message: `Estoque cobre aproximadamente ${coverageDays} dia(s).`, action: "Acionar pesquisa Open-Dot." }] : coverageDays < (settings?.coverageWarningDays ?? 10) ? [{ level: "WARNING", code: "LOW_STOCK", message: `Estoque cobre aproximadamente ${coverageDays} dia(s).`, action: "Programar reposição." }] : []),
      ...(overdueJobs > 0 ? [{ level: "CRITICAL", code: "OVERDUE_EMAIL_JOBS", message: `${overdueJobs} ordem(ns) de e-mail vencida(s).`, action: "Verificar Open-Dot e revalidar a fila." }] : []),
      ...(overdueD1 > 0 ? [{ level: "WARNING", code: "OVERDUE_D1_GATE", message: `${overdueD1} cadência(s) com gate D1 vencido.`, action: "Abrir Meu Dia e resolver exceções." }] : []),
      ...(publishedTemplateKeys.size < PROSPECTING_EMAIL_TEMPLATE_COUNT ? [{ level: "BLOCKED", code: "EMAIL_TEMPLATES_MISSING", message: `${PROSPECTING_EMAIL_TEMPLATE_COUNT - publishedTemplateKeys.size} template(s) de e-mail ainda não publicado(s).`, action: "Cadastrar as copys aprovadas." }] : []),
      ...(!senderReady ? [{ level: "BLOCKED", code: "EMAIL_SENDER_NOT_READY", message: "Nenhum remetente possui SPF, DKIM e DMARC verificados.", action: "Concluir contas e reputação." }] : []),
      ...(!settings?.privacyApprovedAt ? [{ level: "BLOCKED", code: "PRIVACY_APPROVAL_MISSING", message: "Aprovação de privacidade/compliance não registrada.", action: "Obter e registrar a aprovação formal." }] : []),
      ...(!settings?.canaryApprovedAt ? [{ level: "BLOCKED", code: "CANARY_APPROVAL_MISSING", message: "Canário real ainda não foi aprovado.", action: "Executar homologação controlada antes do egress." }] : []),
    ];

    return {
      generatedAt: now.toISOString(), timeZone: workspace.timeZone, today: todayLocal,
      permissions: { manage: manageDecision.allowed, viewSensitive: sensitiveDecision.allowed && sensitiveDecision.scope === "WORKSPACE" },
      settings: settings ? { ...settings, createdAt: settings.createdAt.toISOString(), updatedAt: settings.updatedAt.toISOString(), privacyApprovedAt: settings.privacyApprovedAt?.toISOString() ?? null, canaryApprovedAt: settings.canaryApprovedAt?.toISOString() ?? null } : null,
      overview: {
        stock: { total: candidateCounts.reduce((sum, row) => sum + row._count._all, 0), ready: candidateCount("READY"), review: candidateCount("REVIEW_REQUIRED"), rejected: candidateCount("REJECTED"), planned: candidateCount("PLANNED"), released: candidateCount("RELEASED"), coverageDays },
        releasesToday, politiciansTouchedToday: touchedToday.length, meetingsThirtyDays,
        pipeline: pipeline ? { id: pipeline.id, stages: pipeline.stages.map((stage) => ({ ...stage, leads: stage._count.currentLeads })) } : null,
        cadenceCounts: cadenceCounts.map((row) => ({ status: row.status, count: row._count._all })),
        emailCounts: jobCounts.map((row) => ({ status: row.status, count: row._count._all })),
        alerts,
        reconciliation: reconciliationState ? { status: reconciliationState.status, lastRunAt: reconciliationState.lastRunAt.toISOString() } : null,
        lastResearch: lastResearch ? { ...lastResearch, receivedAt: lastResearch.receivedAt.toISOString() } : null, lastEmailClient: lastEmailClient ? { ...lastEmailClient, receivedAt: lastEmailClient.receivedAt.toISOString() } : null,
      },
      stock: {
        filters: query, total: candidateTotal, page: query.page, pageSize,
        items: candidates.map((candidate) => {
          const canViewContact = sensitiveDecision.allowed && sensitiveDecision.scope === "WORKSPACE";
          return { ...candidate, phone: canViewContact ? candidate.phone : null, normalizedEmail: canViewContact ? candidate.normalizedEmail : null, politicianPhone: canViewContact ? candidate.politicianPhone : null, politicianEmail: canViewContact ? candidate.politicianEmail : null, advisorPhone: canViewContact ? candidate.advisorPhone : null, advisorEmail: canViewContact ? candidate.advisorEmail : null, whatsapp: canViewContact ? candidate.whatsapp : null, instagram: canViewContact ? candidate.instagram : null, mandateVerifiedAt: candidate.mandateVerifiedAt.toISOString(), plannedReleaseDate: candidate.plannedReleaseDate?.toISOString().slice(0, 10) ?? null, releasedAt: candidate.releasedAt?.toISOString() ?? null, sourceCount: candidateSourceCounts.find((row) => row.candidateId === candidate.id)?._count._all ?? 0 };
        }),
        releases: releases.map((release) => ({ ...release, plannedDate: release.plannedDate.toISOString().slice(0, 10) })),
      },
      sellers: sellers.map((seller) => { const member = memberById.get(seller.memberId); return { ...seller, name: member?.user.displayName ?? "Membro indisponível", available: seller.active && member?.status === "ACTIVE" && member.user.status === "ACTIVE" && !member.leadReceivingPausedAt }; }),
      sellerOptions: sellerOptions.map((member) => ({ id: member.id, name: member.user.displayName })),
      capacity: [...capacityByKey.entries()].map(([key, value]) => {
        const separator = key.lastIndexOf(":");
        const memberId = key.slice(0, separator);
        const localDate = key.slice(separator + 1);
        const seller = sellers.find((item) => item.memberId === memberId);
        const limit = seller?.dailyCapacity ?? 75;
        return { memberId, memberName: memberById.get(memberId)?.user.displayName ?? "Membro indisponível", localDate, ...value, projected: value.realized + value.scheduled + value.planned, limit, overCapacity: value.realized + value.scheduled + value.planned > limit };
      }).sort((left, right) => left.localDate.localeCompare(right.localDate) || left.memberName.localeCompare(right.memberName)),
      activities: { items: manualTasks.map((task) => ({ ...task, dueAt: task.dueAt.toISOString(), completedAt: task.completedAt?.toISOString() ?? null })), total: manualTaskTotal, page: query.activityPage, pageSize },
      email: { jobs: recentJobs.map((job) => ({ ...job, scheduledAt: job.scheduledAt.toISOString(), expiresAt: job.expiresAt.toISOString(), sentAt: job.sentAt?.toISOString() ?? null })), pagination: { total: emailJobTotal, page: query.emailPage, pageSize }, templates: templates.map((template) => ({ ...template, publishedAt: template.publishedAt?.toISOString() ?? null })), senders: senders.map((sender) => ({ ...sender, senderAddressNormalized: sensitiveDecision.allowed && sensitiveDecision.scope === "WORKSPACE" ? sender.senderAddressNormalized : "••••@" + sender.domain, lastSuccessAt: sender.lastSuccessAt?.toISOString() ?? null })) },
      metrics: {
        period: { start: thirtyDaysAgo.toISOString(), end: now.toISOString(), timeZone: workspace.timeZone },
        candidateCounts: candidateCounts.map((row) => ({ status: row.status, count: row._count._all })),
        cadenceCounts: cadenceCounts.map((row) => ({ status: row.status, count: row._count._all })),
        emailCounts: jobCounts.map((row) => ({ status: row.status, count: row._count._all })),
        manualCompletionCounts: manualCompletionCounts.map((row) => ({ channel: row.kind, count: row._count._all })),
        discardReasons: cadenceStopCounts.map((row) => ({ reason: row.stopReasonCode ?? "NONE", count: row._count._all })),
        responseRateThirtyDays: releasesThirtyDays > 0 ? Math.round(conversationsThirtyDays / releasesThirtyDays * 10_000) / 100 : 0,
        releasesThirtyDays,
        conversationsThirtyDays,
        lastSourceObservedAt: latestSourceObservation._max.observedAt?.toISOString() ?? null,
        politiciansTouchedToday: touchedToday.length, releasesToday, meetingsThirtyDays,
      },
    };
  }

  return Object.freeze({ getScreen });
}

let singleton: ReturnType<typeof createProspectingWorkspaceService> | undefined;
export function getProspectingWorkspaceService() {
  singleton ??= createProspectingWorkspaceService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
