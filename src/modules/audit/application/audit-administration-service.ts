import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  auditQuerySchema,
  processViolationActionSchema,
  processViolationHref,
  processViolationLabels,
  processViolationTypes,
  slaViolationSeverity,
  type AuditScreen,
  type ProcessViolationSeverityValue,
  type ProcessViolationTypeValue,
} from "@/modules/audit/domain/audit-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { parseWorkspaceLocalDateTime } from "@/shared/core/time/workspace-time";

const PAGE_SIZE = 25;
const OPEN_LEAD_STAGE_CODES = [
  "NEW",
  "TRYING_CONTACT",
  "CONNECTED",
  "IN_QUALIFICATION",
  "QUALIFIED",
  "MEETING_SCHEDULED",
  "NURTURING",
] as const;
const AUTO_RESOLVABLE_TYPES = new Set<ProcessViolationTypeValue>(
  processViolationTypes.filter((type) => type !== "SLA_VIOLATED"),
);

type Candidate = Readonly<{
  type: ProcessViolationTypeValue;
  severity: ProcessViolationSeverityValue;
  fingerprint: string;
  leadId: string | null;
  meetingId: string | null;
  opportunityId: string | null;
  slaCycleId: string | null;
  stageHistoryId: string | null;
  title: string;
  evidenceSummary: string;
  evidence: Prisma.InputJsonValue;
}>;

type AuditServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: Readonly<{
    authorize: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<AuthorizationDecision>;
    assertAuthorized: (context: AuthenticatedContext, permissionKey: PermissionKey, resource: ResourceScope) => Promise<void>;
  }>;
  now: () => Date;
}>;

function invalidInput(message: string): never {
  throw new ApplicationError(message, {
    code: "INVALID_AUDIT_INPUT",
    statusCode: 400,
    expose: true,
  });
}

function notFound(): never {
  throw new ApplicationError("Achado de processo não encontrado.", {
    code: "PROCESS_VIOLATION_NOT_FOUND",
    statusCode: 404,
    expose: true,
  });
}

function conflict(message: string): never {
  throw new ApplicationError(message, {
    code: "PROCESS_VIOLATION_CONFLICT",
    statusCode: 409,
    expose: true,
  });
}

function parseDate(value: string | undefined, label: string, timeZone: string): Date | undefined {
  if (!value) return undefined;
  try {
    const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
      ? parseWorkspaceLocalDateTime(value, timeZone)
      : new Date(value);
    if (Number.isNaN(parsed.getTime())) invalidInput(`${label} inválida.`);
    return parsed;
  } catch {
    invalidInput(`${label} inválida.`);
  }
}

function elapsedSeconds(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1_000));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const sensitiveKey = /password|senha|token|secret|cookie|authorization|rawpayload|phone|telefone|email|ipaddress|useragent/i;

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[conteúdo profundo omitido]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditValue(item, depth + 1));
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? "[dado sensível ocultado]" : sanitizeAuditValue(item, depth + 1),
  ]));
}

function auditParts(value: unknown) {
  const changes = asRecord(value);
  if (!changes) return { before: null, after: null, details: sanitizeAuditValue(value) };
  const before = changes.before ?? changes.previous ?? ("from" in changes ? { value: changes.from } : null);
  const after = changes.after ?? changes.next ?? ("to" in changes ? { value: changes.to } : null);
  const details = Object.fromEntries(Object.entries(changes).filter(([key]) =>
    !["before", "previous", "from", "after", "next", "to"].includes(key)));
  return {
    before: sanitizeAuditValue(before),
    after: sanitizeAuditValue(after),
    details: sanitizeAuditValue(details),
  };
}

function jsonString(value: unknown, key: string): string | null {
  const record = asRecord(value);
  return typeof record?.[key] === "string" ? record[key] as string : null;
}

async function buildAuditEntityMap(
  database: Prisma.TransactionClient,
  workspaceId: string,
  rows: readonly Readonly<{ entityType: string; entityId: string; changes: unknown; metadata: unknown }>[],
) {
  const leadIds = new Set<string>();
  const meetingIds = new Set<string>();
  const opportunityIds = new Set<string>();
  const violationIds = new Set<string>();
  for (const row of rows) {
    if (row.entityType === "Lead") leadIds.add(row.entityId);
    if (row.entityType === "Meeting") meetingIds.add(row.entityId);
    if (row.entityType === "Opportunity") opportunityIds.add(row.entityId);
    if (row.entityType === "ProcessViolation") violationIds.add(row.entityId);
    const leadId = jsonString(row.changes, "leadId") ?? jsonString(row.metadata, "leadId");
    if (leadId) leadIds.add(leadId);
  }
  const [leads, meetings, opportunities, violations] = await Promise.all([
    database.lead.findMany({
      where: { workspaceId, id: { in: [...leadIds] } },
      select: { id: true, fullName: true },
    }),
    database.meeting.findMany({
      where: { workspaceId, id: { in: [...meetingIds] } },
      select: { id: true, title: true, leadId: true },
    }),
    database.opportunity.findMany({
      where: { workspaceId, id: { in: [...opportunityIds] } },
      select: { id: true, name: true, leadId: true },
    }),
    database.processViolation.findMany({
      where: { workspaceId, id: { in: [...violationIds] } },
      select: { id: true, title: true, leadId: true, meetingId: true, opportunityId: true },
    }),
  ]);
  const result = new Map<string, { label: string; href: string | null }>();
  for (const lead of leads) result.set(`Lead:${lead.id}`, { label: lead.fullName, href: `/leads/${lead.id}/historico` });
  for (const meeting of meetings) result.set(`Meeting:${meeting.id}`, { label: meeting.title, href: `/agenda/reunioes/${meeting.id}` });
  for (const opportunity of opportunities) result.set(`Opportunity:${opportunity.id}`, { label: opportunity.name, href: `/leads/${opportunity.leadId}/historico#oportunidade` });
  for (const violation of violations) result.set(`ProcessViolation:${violation.id}`, {
    label: violation.title,
    href: processViolationHref(violation),
  });
  return result;
}

function candidate(input: Candidate): Candidate {
  return Object.freeze(input);
}

export async function collectProcessViolationCandidates(
  database: Prisma.TransactionClient,
  workspaceId: string,
  now: Date,
): Promise<readonly Candidate[]> {
  // An interactive transaction owns one PostgreSQL connection. Keep these
  // reads sequential so the pg adapter never issues overlapping client.query calls.
  const workspace = await database.workspace.findFirstOrThrow({
    where: { id: workspaceId, deletedAt: null },
    select: {
      leadStagnationDays: true,
      commercialSettingsRevision: true,
      commercialSettings: {
        orderBy: [{ revision: "desc" }, { id: "desc" }],
        take: 1,
        select: { revision: true, leadStagnationDays: true },
      },
    },
  });
  const leads = await database.lead.findMany({
      where: { workspaceId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        status: true,
        updatedAt: true,
        ownerMemberId: true,
        queueId: true,
        currentStageId: true,
        currentStage: { select: { name: true, leadStageCode: true } },
        owner: {
          select: {
            status: true,
            deletedAt: true,
            user: { select: { status: true, deletedAt: true } },
            teamMemberships: {
              where: { function: "SDR", deletedAt: null },
              select: { teamId: true },
            },
          },
        },
        queue: { select: { name: true, deletedAt: true } },
        routingQueue: { select: { teamId: true, deletedAt: true } },
        stageHistory: {
          where: { exitedAt: null },
          orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
          select: { id: true, stageId: true, enteredAt: true },
        },
        slaCycles: {
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            receivedAt: true,
            firstHumanAttemptAt: true,
            firstHumanAttemptSeconds: true,
            priorityBand: {
              select: {
                code: true,
                slaPolicy: { select: { name: true, healthyMaxSeconds: true, attentionMaxSeconds: true } },
              },
            },
          },
        },
        qualification: {
          select: {
            id: true,
            revision: true,
            status: true,
            revisions: {
              where: { kind: "VALIDATED" },
              orderBy: [{ revisionNumber: "desc" }, { id: "desc" }],
              take: 1,
              select: { id: true, isQualificationReady: true, investigatedDimensions: true, minimumRequiredDimensions: true },
            },
          },
        },
        tasks: {
          where: { status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
          orderBy: [{ dueAt: "asc" }, { id: "asc" }],
          take: 1,
          select: { id: true, dueAt: true },
        },
      },
  });
  const meetings = await database.meeting.findMany({
      where: { workspaceId, status: { in: ["SCHEDULED", "CONFIRMED"] }, deletedAt: null },
      select: {
        id: true,
        title: true,
        leadId: true,
        startsAt: true,
        revision: true,
        lead: {
          select: {
            fullName: true,
            qualification: {
              select: {
                revisions: {
                  where: { kind: "VALIDATED" },
                  orderBy: [{ revisionNumber: "desc" }, { id: "desc" }],
                  take: 1,
                  select: { id: true, isQualificationReady: true },
                },
              },
            },
          },
        },
      },
  });
  const opportunities = await database.opportunity.findMany({
      where: { workspaceId, deletedAt: null },
      select: {
        id: true,
        leadId: true,
        name: true,
        status: true,
        revision: true,
        currentStageId: true,
        lossReasonId: true,
        lossReason: { select: { active: true, deletedAt: true } },
        tasks: {
          where: { status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
          take: 1,
          select: { id: true, dueAt: true },
        },
        stageHistory: {
          where: { exitedAt: null },
          orderBy: [{ enteredAt: "asc" }, { id: "asc" }],
          select: { id: true, stageId: true, enteredAt: true },
        },
      },
  });

  const settings = workspace.commercialSettings[0] ?? {
    revision: workspace.commercialSettingsRevision,
    leadStagnationDays: workspace.leadStagnationDays,
  };
  const stagnationCut = new Date(now.getTime() - settings.leadStagnationDays * 86_400_000);
  const result: Candidate[] = [];

  for (const lead of leads) {
    const isOpenLead = lead.currentStage.leadStageCode !== null
      && OPEN_LEAD_STAGE_CODES.includes(lead.currentStage.leadStageCode as typeof OPEN_LEAD_STAGE_CODES[number]);
    const activeOwner = lead.ownerMemberId !== null
      && lead.queueId === null
      && lead.owner?.status === "ACTIVE"
      && lead.owner.deletedAt === null
      && lead.owner.user.status === "ACTIVE"
      && lead.owner.user.deletedAt === null
      && lead.routingQueue?.deletedAt === null
      && lead.owner.teamMemberships.some((membership) =>
        lead.routingQueue?.teamId === null || membership.teamId === lead.routingQueue?.teamId);
    const activeQueue = lead.queueId !== null && lead.ownerMemberId === null && lead.queue?.deletedAt === null;
    if (isOpenLead && !activeOwner && !activeQueue) {
      result.push(candidate({
        type: "LEAD_WITHOUT_OPERATIONAL_OWNER",
        severity: "CRITICAL",
        fingerprint: `owner:${lead.id}:${lead.updatedAt.toISOString()}`,
        leadId: lead.id,
        meetingId: null,
        opportunityId: null,
        slaCycleId: null,
        stageHistoryId: lead.stageHistory[0]?.id ?? null,
        title: processViolationLabels.LEAD_WITHOUT_OPERATIONAL_OWNER,
        evidenceSummary: `${lead.fullName} não possui membro ativo nem fila ativa como responsável explícito.`,
        evidence: { ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, leadUpdatedAt: lead.updatedAt.toISOString() },
      }));
    }

    for (const cycle of lead.slaCycles) {
      const seconds = cycle.firstHumanAttemptSeconds
        ?? (cycle.firstHumanAttemptAt ? elapsedSeconds(cycle.receivedAt, cycle.firstHumanAttemptAt) : elapsedSeconds(cycle.receivedAt, now));
      if (seconds > 0) {
        result.push(candidate({
          type: "SLA_VIOLATED",
          severity: slaViolationSeverity(seconds),
          fingerprint: `sla:${cycle.id}`,
          leadId: lead.id,
          meetingId: null,
          opportunityId: null,
          slaCycleId: cycle.id,
          stageHistoryId: null,
          title: processViolationLabels.SLA_VIOLATED,
          evidenceSummary: `${lead.fullName}: ${seconds}s até a tentativa ou até o corte; política ${cycle.priorityBand.slaPolicy.name}.`,
          evidence: {
            receivedAt: cycle.receivedAt.toISOString(),
            firstHumanAttemptAt: cycle.firstHumanAttemptAt?.toISOString() ?? null,
            measuredSeconds: seconds,
            healthyMaxSeconds: cycle.priorityBand.slaPolicy.healthyMaxSeconds,
            attentionMaxSeconds: cycle.priorityBand.slaPolicy.attentionMaxSeconds,
            priorityBand: cycle.priorityBand.code,
            policyMinutes: 0,
          },
        }));
      }
    }

    const latestCycle = lead.slaCycles.at(-1);
    if (isOpenLead && !lead.slaCycles.some((cycle) => cycle.firstHumanAttemptAt !== null)) {
      result.push(candidate({
        type: "LEAD_WITHOUT_ATTEMPT",
        severity: "CRITICAL",
        fingerprint: `no-attempt:${lead.id}:${latestCycle?.id ?? "no-sla-cycle"}`,
        leadId: lead.id,
        meetingId: null,
        opportunityId: null,
        slaCycleId: latestCycle?.id ?? null,
        stageHistoryId: null,
        title: processViolationLabels.LEAD_WITHOUT_ATTEMPT,
        evidenceSummary: latestCycle
          ? `${lead.fullName} não possui primeira tentativa humana em nenhum ciclo de SLA.`
          : `${lead.fullName} não possui ciclo de SLA nem primeira tentativa humana.`,
        evidence: {
          latestCycleId: latestCycle?.id ?? null,
          receivedAt: latestCycle?.receivedAt.toISOString() ?? null,
          slaCycleMissing: latestCycle === undefined,
        },
      }));
    }

    if (
      ["IN_QUALIFICATION", "QUALIFIED", "MEETING_SCHEDULED"].includes(lead.currentStage.leadStageCode ?? "")
      && !lead.qualification?.revisions[0]?.isQualificationReady
    ) {
      const revision = lead.qualification?.revisions[0];
      result.push(candidate({
        type: "PACTO_INCOMPLETE",
        severity: lead.currentStage.leadStageCode === "IN_QUALIFICATION" ? "MEDIUM" : "HIGH",
        fingerprint: `pacto:${lead.id}:${lead.stageHistory[0]?.id ?? "no-stage"}:r${lead.qualification?.revision ?? 0}`,
        leadId: lead.id,
        meetingId: null,
        opportunityId: null,
        slaCycleId: null,
        stageHistoryId: lead.stageHistory[0]?.id ?? null,
        title: processViolationLabels.PACTO_INCOMPLETE,
        evidenceSummary: `${lead.fullName} está em ${lead.currentStage.name} sem PACTO humano validado e apto.`,
        evidence: {
          qualificationStatus: lead.qualification?.status ?? "NOT_STARTED",
          latestValidatedRevisionId: revision?.id ?? null,
          investigatedDimensions: revision?.investigatedDimensions ?? 0,
          minimumRequiredDimensions: revision?.minimumRequiredDimensions ?? null,
        },
      }));
    }

    const openHistory = lead.stageHistory;
    if (openHistory.length !== 1 || openHistory[0]?.stageId !== lead.currentStageId) {
      result.push(candidate({
        type: "INCOHERENT_STAGE_CHANGE",
        severity: "HIGH",
        fingerprint: `stage-lead:${lead.id}:${lead.currentStageId}:${openHistory.map((row) => row.id).join(",") || "none"}`,
        leadId: lead.id,
        meetingId: null,
        opportunityId: null,
        slaCycleId: null,
        stageHistoryId: openHistory[0]?.id ?? null,
        title: processViolationLabels.INCOHERENT_STAGE_CHANGE,
        evidenceSummary: `${lead.fullName} possui etapa atual divergente dos intervalos abertos de StageHistory.`,
        evidence: { currentStageId: lead.currentStageId, openStageHistoryIds: openHistory.map((row) => row.id), openStageIds: openHistory.map((row) => row.stageId) },
      }));
    }

    const currentHistory = openHistory.find((row) => row.stageId === lead.currentStageId);
    if (isOpenLead && currentHistory && currentHistory.enteredAt <= stagnationCut) {
      result.push(candidate({
        type: "LEAD_STAGNANT",
        severity: "MEDIUM",
        fingerprint: `stagnant:${lead.id}:${currentHistory.id}:settings-${settings.revision}`,
        leadId: lead.id,
        meetingId: null,
        opportunityId: null,
        slaCycleId: null,
        stageHistoryId: currentHistory.id,
        title: processViolationLabels.LEAD_STAGNANT,
        evidenceSummary: `${lead.fullName} permanece em ${lead.currentStage.name} além de ${settings.leadStagnationDays} dias.`,
        evidence: { enteredAt: currentHistory.enteredAt.toISOString(), thresholdDays: settings.leadStagnationDays, settingsRevision: settings.revision },
      }));
    }

    if (isOpenLead && lead.tasks.length === 0) {
      result.push(candidate({
        type: "LEAD_WITHOUT_NEXT_ACTION",
        severity: "CRITICAL",
        fingerprint: `no-next-lead:${lead.id}:${lead.updatedAt.toISOString()}`,
        leadId: lead.id,
        meetingId: null,
        opportunityId: null,
        slaCycleId: null,
        stageHistoryId: currentHistory?.id ?? null,
        title: processViolationLabels.LEAD_WITHOUT_NEXT_ACTION,
        evidenceSummary: `${lead.fullName} está no backlog sem tarefa ativa.`,
        evidence: { currentStageId: lead.currentStageId, activeTaskCount: 0, leadUpdatedAt: lead.updatedAt.toISOString(), metricKey: "leadsWithoutNextAction" },
      }));
    }
  }

  for (const meeting of meetings) {
    const revision = meeting.lead.qualification?.revisions[0];
    if (!revision?.isQualificationReady) {
      result.push(candidate({
        type: "MEETING_WITHOUT_BRIEFING",
        severity: "HIGH",
        fingerprint: `meeting-briefing:${meeting.id}:r${meeting.revision}`,
        leadId: meeting.leadId,
        meetingId: meeting.id,
        opportunityId: null,
        slaCycleId: null,
        stageHistoryId: null,
        title: processViolationLabels.MEETING_WITHOUT_BRIEFING,
        evidenceSummary: `${meeting.title} não possui PACTO humano apto para compor o briefing mínimo do closer.`,
        evidence: { startsAt: meeting.startsAt.toISOString(), meetingRevision: meeting.revision, validatedPactoRevisionId: revision?.id ?? null },
      }));
    }
  }

  for (const opportunity of opportunities) {
    if (opportunity.status === "OPEN" && opportunity.tasks.length === 0) {
      result.push(candidate({
        type: "OPPORTUNITY_WITHOUT_NEXT_ACTION",
        severity: "CRITICAL",
        fingerprint: `no-next-opportunity:${opportunity.id}:r${opportunity.revision}`,
        leadId: opportunity.leadId,
        meetingId: null,
        opportunityId: opportunity.id,
        slaCycleId: null,
        stageHistoryId: opportunity.stageHistory[0]?.id ?? null,
        title: processViolationLabels.OPPORTUNITY_WITHOUT_NEXT_ACTION,
        evidenceSummary: `${opportunity.name} está aberta sem tarefa vinculada ativa.`,
        evidence: { opportunityRevision: opportunity.revision, activeTaskCount: 0 },
      }));
    }
    if (opportunity.status === "LOST" && (!opportunity.lossReasonId || opportunity.lossReason?.deletedAt)) {
      result.push(candidate({
        type: "LOST_OPPORTUNITY_WITHOUT_REASON",
        severity: "HIGH",
        fingerprint: `lost-reason:${opportunity.id}:r${opportunity.revision}`,
        leadId: opportunity.leadId,
        meetingId: null,
        opportunityId: opportunity.id,
        slaCycleId: null,
        stageHistoryId: opportunity.stageHistory[0]?.id ?? null,
        title: processViolationLabels.LOST_OPPORTUNITY_WITHOUT_REASON,
        evidenceSummary: opportunity.lossReasonId
          ? `${opportunity.name} referencia um motivo de perda excluído e não consultável pela operação.`
          : `${opportunity.name} está perdida sem motivo registrado.`,
        evidence: {
          opportunityRevision: opportunity.revision,
          lossReasonId: opportunity.lossReasonId,
          reasonDeletedAt: opportunity.lossReason?.deletedAt?.toISOString() ?? null,
        },
      }));
    }
    if (opportunity.stageHistory.length !== 1 || opportunity.stageHistory[0]?.stageId !== opportunity.currentStageId) {
      result.push(candidate({
        type: "INCOHERENT_STAGE_CHANGE",
        severity: "HIGH",
        fingerprint: `stage-opportunity:${opportunity.id}:${opportunity.currentStageId}:${opportunity.stageHistory.map((row) => row.id).join(",") || "none"}`,
        leadId: opportunity.leadId,
        meetingId: null,
        opportunityId: opportunity.id,
        slaCycleId: null,
        stageHistoryId: opportunity.stageHistory[0]?.id ?? null,
        title: processViolationLabels.INCOHERENT_STAGE_CHANGE,
        evidenceSummary: `${opportunity.name} possui etapa atual divergente dos intervalos abertos de StageHistory.`,
        evidence: { currentStageId: opportunity.currentStageId, openStageHistoryIds: opportunity.stageHistory.map((row) => row.id), openStageIds: opportunity.stageHistory.map((row) => row.stageId) },
      }));
    }
  }

  return Object.freeze(result);
}

function activeFinding(status: string): boolean {
  return status === "OPEN" || status === "ACKNOWLEDGED";
}

export function createAuditAdministrationService(options: AuditServiceOptions) {
  async function assertRead(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AUDIT_READ, {
      workspaceId: context.workspaceId,
      resourceType: "AuditLog",
      resourceId: context.workspaceId,
    });
  }

  async function canManage(context: AuthenticatedContext) {
    const decision = await options.authorization.authorize(context, PermissionKeys.AUDIT_MANAGE, {
      workspaceId: context.workspaceId,
      resourceType: "ProcessViolation",
      resourceId: context.workspaceId,
    });
    return decision.allowed;
  }

  async function scan(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AUDIT_MANAGE, {
      workspaceId: context.workspaceId,
      resourceType: "ProcessViolation",
      resourceId: context.workspaceId,
    });
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.workspaceId}), hashtext('crm24-process-health'))`;
      const systemActor = await transaction.actor.findFirstOrThrow({
        where: { workspaceId: context.workspaceId, key: "system", type: "SYSTEM" },
        select: { id: true },
      });
      const candidates = await collectProcessViolationCandidates(transaction, context.workspaceId, now);
      const fingerprints = new Set(candidates.map((item) => item.fingerprint));
      const existing = await transaction.processViolation.findMany({
        where: { workspaceId: context.workspaceId },
        select: { id: true, fingerprint: true, type: true, status: true },
      });
      const byFingerprint = new Map(existing.map((row) => [row.fingerprint, row]));
      let created = 0;
      let refreshed = 0;
      let autoResolved = 0;
      for (const item of candidates) {
        const current = byFingerprint.get(item.fingerprint);
        if (current) {
          if (activeFinding(current.status)) {
            await transaction.processViolation.update({
              where: { id: current.id },
              data: { lastDetectedAt: now, updatedAt: now },
            });
            refreshed += 1;
          }
          continue;
        }
        const createdFinding = await transaction.processViolation.create({
          data: {
            workspaceId: context.workspaceId,
            type: item.type,
            severity: item.severity,
            status: "OPEN",
            fingerprint: item.fingerprint,
            leadId: item.leadId,
            meetingId: item.meetingId,
            opportunityId: item.opportunityId,
            slaCycleId: item.slaCycleId,
            stageHistoryId: item.stageHistoryId,
            title: item.title,
            evidenceSummary: item.evidenceSummary,
            evidence: item.evidence,
            detectedAt: now,
            lastDetectedAt: now,
            detectedByActorId: systemActor.id,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: systemActor.id,
            action: "process_health.violation.detected",
            entityType: "ProcessViolation",
            entityId: createdFinding.id,
            origin: "SYSTEM",
            occurredAt: now,
            changes: { type: item.type, severity: item.severity, leadId: item.leadId, meetingId: item.meetingId, opportunityId: item.opportunityId },
            metadata: { requestedByActorId: context.actorId, deterministic: true, fingerprint: item.fingerprint },
          },
        });
        created += 1;
      }
      for (const current of existing) {
        if (
          !activeFinding(current.status)
          || !AUTO_RESOLVABLE_TYPES.has(current.type)
          || fingerprints.has(current.fingerprint)
        ) continue;
        await transaction.processViolation.update({
          where: { id: current.id },
          data: {
            status: "RESOLVED",
            ...(current.status === "OPEN" ? {
              acknowledgedAt: now,
              acknowledgedByActorId: systemActor.id,
            } : {}),
            resolvedAt: now,
            resolvedByActorId: systemActor.id,
            resolutionReason: "A condição determinística não está mais ativa após correção pelo fluxo normal.",
            updatedAt: now,
          },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: systemActor.id,
            action: "process_health.violation.auto_resolved",
            entityType: "ProcessViolation",
            entityId: current.id,
            origin: "SYSTEM",
            reason: "A condição determinística não está mais ativa após correção pelo fluxo normal.",
            occurredAt: now,
            changes: { before: { status: current.status }, after: { status: "RESOLVED" } },
            metadata: { requestedByActorId: context.actorId, deterministic: true },
          },
        });
        autoResolved += 1;
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "process_health.scan.completed",
          entityType: "Workspace",
          entityId: context.workspaceId,
          origin: "API",
          occurredAt: now,
          changes: { candidates: candidates.length, created, refreshed, autoResolved },
          metadata: { deterministic: true },
        },
      });
      return Object.freeze({ candidates: candidates.length, created, refreshed, autoResolved });
    }, { isolationLevel: "Serializable" });
  }

  async function act(context: AuthenticatedContext, violationId: string, payload: unknown) {
    await options.authorization.assertAuthorized(context, PermissionKeys.AUDIT_MANAGE, {
      workspaceId: context.workspaceId,
      resourceType: "ProcessViolation",
      resourceId: violationId,
    });
    const parsed = processViolationActionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error.issues[0]?.message ?? "Ação de auditoria inválida.");
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.workspaceId}), hashtext(${violationId}))`;
      const finding = await transaction.processViolation.findFirst({
        where: { id: violationId, workspaceId: context.workspaceId },
      });
      if (!finding) notFound();
      if (finding.updatedAt.getTime() !== parsed.data.expectedUpdatedAt.getTime()) {
        conflict("O achado mudou desde o carregamento. Atualize a página antes de continuar.");
      }
      if (parsed.data.action === "ACKNOWLEDGE") {
        if (finding.status === "RESOLVED") conflict("Um achado resolvido não pode voltar a reconhecido.");
        if (finding.status === "ACKNOWLEDGED") return Object.freeze({ id: finding.id, status: finding.status, updatedAt: finding.updatedAt.toISOString() });
        const updated = await transaction.processViolation.update({
          where: { id: finding.id },
          data: { status: "ACKNOWLEDGED", acknowledgedAt: now, acknowledgedByActorId: context.actorId, updatedAt: now },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "process_health.violation.acknowledged",
            entityType: "ProcessViolation",
            entityId: finding.id,
            origin: "API",
            occurredAt: now,
            changes: { before: { status: finding.status }, after: { status: updated.status } },
          },
        });
        return Object.freeze({ id: updated.id, status: updated.status, updatedAt: updated.updatedAt.toISOString() });
      }
      if (finding.status !== "ACKNOWLEDGED") conflict("Reconheça o achado antes de resolvê-lo.");
      const resolutionReason = parsed.data.reason;
      if (!resolutionReason) invalidInput("Informe o motivo da resolução.");
      if (finding.type !== "SLA_VIOLATED") {
        const candidates = await collectProcessViolationCandidates(transaction, context.workspaceId, now);
        if (candidates.some((item) => item.fingerprint === finding.fingerprint)) {
          conflict("A evidência ainda está ativa. Corrija o registro pelo serviço de domínio e revalide antes de resolver.");
        }
      }
      const updated = await transaction.processViolation.update({
        where: { id: finding.id },
        data: {
          status: "RESOLVED",
          resolvedAt: now,
          resolvedByActorId: context.actorId,
          resolutionReason,
          updatedAt: now,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "process_health.violation.resolved",
          entityType: "ProcessViolation",
          entityId: finding.id,
          origin: "API",
          reason: resolutionReason,
          occurredAt: now,
          changes: { before: { status: finding.status }, after: { status: updated.status } },
          metadata: { underlyingFactPreserved: true },
        },
      });
      return Object.freeze({ id: updated.id, status: updated.status, updatedAt: updated.updatedAt.toISOString() });
    }, { isolationLevel: "Serializable" });
  }

  async function getScreen(context: AuthenticatedContext, rawQuery: unknown): Promise<AuditScreen> {
    await assertRead(context);
    const parsedQuery = auditQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) invalidInput(parsedQuery.error.issues[0]?.message ?? "Filtros de auditoria inválidos.");
    const query = parsedQuery.data;
    const [workspace, manage] = await Promise.all([
      options.database.workspace.findFirstOrThrow({
        where: { id: context.workspaceId, deletedAt: null },
        select: { timeZone: true },
      }),
      canManage(context),
    ]);
    const from = parseDate(query.auditFrom, "Data inicial", workspace.timeZone);
    const to = parseDate(query.auditTo, "Data final", workspace.timeZone);
    if (from && to && from >= to) invalidInput("A data final deve ser posterior à inicial.");
    const auditWhere: Prisma.AuditLogWhereInput = {
      workspaceId: context.workspaceId,
      ...(query.auditActorType ? { actor: { type: query.auditActorType } } : {}),
      ...(query.auditActorId ? { actorId: query.auditActorId } : {}),
      ...(query.auditOrigin ? { origin: query.auditOrigin } : {}),
      ...(query.auditAction ? { action: query.auditAction } : {}),
      ...(query.auditEntityType ? { entityType: query.auditEntityType } : {}),
      ...((from || to) ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(query.auditSearch ? {
        OR: [
          { action: { contains: query.auditSearch, mode: "insensitive" } },
          { entityType: { contains: query.auditSearch, mode: "insensitive" } },
          { requestId: { contains: query.auditSearch, mode: "insensitive" } },
          { actor: { displayName: { contains: query.auditSearch, mode: "insensitive" } } },
        ],
      } : {}),
    };
    const violationWhere: Prisma.ProcessViolationWhereInput = {
      workspaceId: context.workspaceId,
      ...(query.violationType ? { type: query.violationType } : {}),
      ...(query.violationSeverity ? { severity: query.violationSeverity } : {}),
      ...(query.violationStatus ? { status: query.violationStatus } : {}),
      ...(query.violationSearch ? {
        OR: [
          { title: { contains: query.violationSearch, mode: "insensitive" } },
          { evidenceSummary: { contains: query.violationSearch, mode: "insensitive" } },
          { lead: { fullName: { contains: query.violationSearch, mode: "insensitive" } } },
          { meeting: { title: { contains: query.violationSearch, mode: "insensitive" } } },
          { opportunity: { name: { contains: query.violationSearch, mode: "insensitive" } } },
        ],
      } : {}),
    };

    const [
      auditTotal,
      auditRows,
      violationTotal,
      violationRows,
      actors,
      actionRows,
      entityRows,
      summaryRows,
      liveCandidates,
    ] = await options.database.$transaction(async (transaction) => Promise.all([
      transaction.auditLog.count({ where: auditWhere }),
      transaction.auditLog.findMany({
        where: auditWhere,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (query.auditPage - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { actor: { select: { id: true, displayName: true, type: true } } },
      }),
      transaction.processViolation.count({ where: violationWhere }),
      transaction.processViolation.findMany({
        where: violationWhere,
        orderBy: [{ severity: "desc" }, { detectedAt: "desc" }, { id: "desc" }],
        skip: (query.violationPage - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          lead: { select: { fullName: true } },
          meeting: { select: { title: true } },
          opportunity: { select: { name: true } },
          acknowledgedBy: { select: { displayName: true } },
          resolvedBy: { select: { displayName: true } },
        },
      }),
      transaction.actor.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: [{ type: "asc" }, { displayName: "asc" }],
        select: { id: true, displayName: true, type: true },
      }),
      transaction.auditLog.findMany({
        where: { workspaceId: context.workspaceId }, distinct: ["action"], orderBy: { action: "asc" }, select: { action: true },
      }),
      transaction.auditLog.findMany({
        where: { workspaceId: context.workspaceId }, distinct: ["entityType"], orderBy: { entityType: "asc" }, select: { entityType: true },
      }),
      transaction.processViolation.groupBy({
        by: ["type", "status", "severity"],
        where: { workspaceId: context.workspaceId },
        _count: { _all: true },
      }),
      collectProcessViolationCandidates(transaction, context.workspaceId, options.now()),
    ]), { isolationLevel: "RepeatableRead" });

    const entityMap = await options.database.$transaction((transaction) =>
      buildAuditEntityMap(transaction, context.workspaceId, auditRows));
    const activeByType = new Map<ProcessViolationTypeValue, number>();
    let open = 0;
    let acknowledged = 0;
    let critical = 0;
    for (const row of summaryRows) {
      if (row.status === "OPEN") open += row._count._all;
      if (row.status === "ACKNOWLEDGED") acknowledged += row._count._all;
      if (activeFinding(row.status)) {
        activeByType.set(row.type, (activeByType.get(row.type) ?? 0) + row._count._all);
        if (row.severity === "CRITICAL") critical += row._count._all;
      }
    }
    const liveStalled = liveCandidates.filter((item) => item.type === "LEAD_STAGNANT").length;
    const liveWithoutNext = liveCandidates.filter((item) => item.type === "LEAD_WITHOUT_NEXT_ACTION").length;
    const findingStalled = activeByType.get("LEAD_STAGNANT") ?? 0;
    const findingWithoutNext = await options.database.processViolation.count({
      where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, type: "LEAD_WITHOUT_NEXT_ACTION" },
    });

    return Object.freeze({
      generatedAt: options.now().toISOString(),
      timeZone: workspace.timeZone,
      capabilities: Object.freeze({ canManage: manage }),
      filters: Object.freeze({
        auditSearch: query.auditSearch,
        auditActorType: query.auditActorType ?? "",
        auditActorId: query.auditActorId ?? "",
        auditOrigin: query.auditOrigin ?? "",
        auditAction: query.auditAction ?? "",
        auditEntityType: query.auditEntityType ?? "",
        auditFrom: query.auditFrom ?? "",
        auditTo: query.auditTo ?? "",
        auditPage: query.auditPage,
        violationSearch: query.violationSearch,
        violationType: query.violationType ?? "",
        violationSeverity: query.violationSeverity ?? "",
        violationStatus: query.violationStatus ?? "",
        violationPage: query.violationPage,
      }),
      filterOptions: Object.freeze({
        actors: Object.freeze(actors.map((actor) => Object.freeze({ id: actor.id, name: actor.displayName, type: actor.type }))),
        actions: Object.freeze(actionRows.map((row) => row.action)),
        entityTypes: Object.freeze(entityRows.map((row) => row.entityType)),
      }),
      audit: Object.freeze({
        total: auditTotal,
        page: query.auditPage,
        pageSize: PAGE_SIZE,
        pageCount: Math.max(1, Math.ceil(auditTotal / PAGE_SIZE)),
        items: Object.freeze(auditRows.map((row) => {
          const parts = auditParts(row.changes);
          const target = entityMap.get(`${row.entityType}:${row.entityId}`);
          return Object.freeze({
            id: row.id,
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            entityLabel: target?.label ?? `${row.entityType} · ${row.entityId}`,
            href: target?.href ?? null,
            occurredAt: row.occurredAt.toISOString(),
            origin: row.origin,
            reason: row.reason,
            actor: Object.freeze({ id: row.actor.id, name: row.actor.displayName, type: row.actor.type }),
            before: parts.before,
            after: parts.after,
            details: parts.details,
            requestId: row.requestId,
            automationRunId: row.automationRunId,
            aiInsightId: row.aiInsightId,
          });
        })),
      }),
      violations: Object.freeze({
        total: violationTotal,
        page: query.violationPage,
        pageSize: PAGE_SIZE,
        pageCount: Math.max(1, Math.ceil(violationTotal / PAGE_SIZE)),
        items: Object.freeze(violationRows.map((row) => Object.freeze({
          id: row.id,
          type: row.type,
          title: row.title,
          severity: row.severity,
          status: row.status,
          evidenceSummary: row.evidenceSummary,
          evidence: sanitizeAuditValue(row.evidence),
          detectedAt: row.detectedAt.toISOString(),
          lastDetectedAt: row.lastDetectedAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
          acknowledgedBy: row.acknowledgedBy?.displayName ?? null,
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
          resolvedBy: row.resolvedBy?.displayName ?? null,
          resolutionReason: row.resolutionReason,
          href: processViolationHref(row),
          entityLabel: row.meeting?.title ?? row.opportunity?.name ?? row.lead?.fullName ?? "Registro relacionado",
        }))),
      }),
      summary: Object.freeze({
        open,
        acknowledged,
        critical,
        byType: Object.freeze(processViolationTypes.map((type) => Object.freeze({ type, label: processViolationLabels[type], count: activeByType.get(type) ?? 0 }))),
      }),
      reconciliation: Object.freeze({
        stalled: Object.freeze({ dashboardCount: liveStalled, activeFindings: findingStalled, reconciled: liveStalled === findingStalled }),
        withoutNextAction: Object.freeze({ dashboardCount: liveWithoutNext, activeFindings: findingWithoutNext, reconciled: liveWithoutNext === findingWithoutNext }),
      }),
    });
  }

  return Object.freeze({ getScreen, scan, act });
}

let service: ReturnType<typeof createAuditAdministrationService> | undefined;

export function getAuditAdministrationService() {
  service ??= createAuditAdministrationService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return service;
}
