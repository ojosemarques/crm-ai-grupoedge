import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService, type createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { OPERATIONS_API_VERSION, telemetryEnvelopeSchema, type OperationsListQuery } from "@/modules/operations/domain/operations-contracts";
import { redactTelemetryValue, sanitizeMetricLabels } from "@/modules/operations/domain/redaction";
import { calculateSlo } from "@/modules/operations/domain/slo";
import { assertSafeOperationalRuntime } from "@/modules/operations/domain/runtime-guards";
import { criticalityCatalog, RESILIENCE_CONTRACT_VERSION } from "@/modules/resilience/domain/resilience-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Options = Readonly<{ database: PrismaClient; now: () => Date; authorization?: ReturnType<typeof createAuthorizationService> }>;

const sloCatalog = [
  { key: "api-availability", name: "Disponibilidade da API", description: "Respostas não classificadas como erro.", metricKey: "api.availability", direction: "HIGHER_IS_BETTER" as const, targetBasisPoints: 9900, windowMinutes: 1440, owner: "Plataforma", runbookKey: "runbook-api" },
  { key: "api-latency", name: "Latência da API", description: "Requisições concluídas em até 1 segundo.", metricKey: "api.latency", direction: "HIGHER_IS_BETTER" as const, targetBasisPoints: 9500, windowMinutes: 1440, owner: "Plataforma", runbookKey: "runbook-api-latency" },
  { key: "jobs", name: "Processamento de jobs", description: "Jobs terminais concluídos com sucesso.", metricKey: "jobs.success", direction: "HIGHER_IS_BETTER" as const, targetBasisPoints: 9900, windowMinutes: 1440, owner: "Operações", runbookKey: "runbook-jobs" },
  { key: "outbox", name: "Entrega local da outbox", description: "Eventos terminais entregues ao sink local.", metricKey: "outbox.success", direction: "HIGHER_IS_BETTER" as const, targetBasisPoints: 9900, windowMinutes: 1440, owner: "Integrações", runbookKey: "runbook-outbox" },
  { key: "privacy-sla", name: "SLA de solicitações LGPD", description: "Solicitações finalizadas dentro do prazo persistido.", metricKey: "privacy.sla", direction: "HIGHER_IS_BETTER" as const, targetBasisPoints: 10000 - 1, windowMinutes: 43_200, owner: "Privacidade", runbookKey: "runbook-dsr" },
] as const;

const alertRules = [
  { key: "jobs-stale", name: "Jobs atrasados", metricKey: "jobs.stale", threshold: 0, severity: "HIGH" as const, cooldownSeconds: 900, owner: "Operações", runbookKey: "runbook-jobs" },
  { key: "outbox-stale", name: "Outbox atrasada", metricKey: "outbox.stale", threshold: 0, severity: "HIGH" as const, cooldownSeconds: 900, owner: "Integrações", runbookKey: "runbook-outbox" },
  { key: "automations-failed", name: "Automações críticas com falha", metricKey: "automations.failed", threshold: 0, severity: "CRITICAL" as const, cooldownSeconds: 900, owner: "Revenue Ops", runbookKey: "runbook-automations" },
  { key: "privacy-overdue", name: "Solicitações LGPD vencidas", metricKey: "privacy.overdue", threshold: 0, severity: "CRITICAL" as const, cooldownSeconds: 3600, owner: "Privacidade", runbookKey: "runbook-dsr" },
  { key: "api-errors", name: "Erros da API", metricKey: "api.errors", threshold: 4, severity: "HIGH" as const, cooldownSeconds: 900, owner: "Plataforma", runbookKey: "runbook-api" },
  { key: "login-failures", name: "Falhas de login", metricKey: "auth.login.failed", threshold: 9, severity: "HIGH" as const, cooldownSeconds: 900, owner: "Segurança", runbookKey: "runbook-auth" },
  { key: "jobs-dead-letter", name: "Jobs em falha terminal", metricKey: "jobs.dead_letter", threshold: 0, severity: "CRITICAL" as const, cooldownSeconds: 900, owner: "Operações", runbookKey: "runbook-jobs" },
  { key: "worker-stale", name: "Worker parado com backlog", metricKey: "worker.stale", threshold: 0, severity: "CRITICAL" as const, cooldownSeconds: 300, owner: "Operações", runbookKey: "runbook-worker" },
  { key: "sla-critical", name: "Leads com SLA crítico", metricKey: "sla.critical", threshold: 0, severity: "HIGH" as const, cooldownSeconds: 300, owner: "Revenue Ops", runbookKey: "runbook-sla" },
] as const;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function workspaceResource(context: AuthenticatedContext) {
  return { workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId } as const;
}

export function createOperationsService(options: Options) {
  const authorization = options.authorization ?? getAuthorizationService();

  async function ensureFoundation(context: AuthenticatedContext) {
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`operations-foundation:${context.workspaceId}`}, 0))`;
      const actor = await tx.actor.findFirst({ where: { workspaceId: context.workspaceId, key: "system" }, select: { id: true } });
      const actorId = actor?.id ?? context.actorId;
      for (const definition of sloCatalog) {
        await tx.sloDefinitionVersion.upsert({
          where: { workspaceId_key_version: { workspaceId: context.workspaceId, key: definition.key, version: 1 } },
          update: {},
          create: { workspaceId: context.workspaceId, version: 1, ...definition, createdByActorId: actorId },
        });
      }
      for (const definition of alertRules) {
        await tx.observabilityRuleVersion.upsert({
          where: { workspaceId_key_version: { workspaceId: context.workspaceId, key: definition.key, version: 1 } },
          update: {},
          create: { workspaceId: context.workspaceId, version: 1, comparator: "GT", queueId: null, active: true, ...definition, createdByActorId: actorId },
        });
      }
    });
  }

  async function recordTelemetry(context: AuthenticatedContext, raw: unknown) {
    await authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context));
    assertSafeOperationalRuntime();
    const input = telemetryEnvelopeSchema.parse(raw);
    const labels = sanitizeMetricLabels(input.labels);
    const metadata = input.metadata ? redactTelemetryValue(input.metadata) : null;
    return options.database.telemetryRecord.create({
      data: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        contractVersion: input.contractVersion,
        kind: input.kind,
        operation: input.operation,
        outcome: input.outcome,
        durationMs: input.durationMs ?? null,
        value: input.value ?? null,
        unit: input.unit ?? null,
        correlationId: input.correlationId,
        requestId: input.requestId ?? null,
        jobId: input.jobId ?? null,
        outboxEventId: input.outboxEventId ?? null,
        labels: json(labels),
        ...(metadata ? { metadata: json(metadata) } : {}),
        occurredAt: input.occurredAt,
      },
      select: { id: true, correlationId: true, occurredAt: true },
    });
  }

  async function sampleMetrics(workspaceId: string) {
    const now = options.now();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const staleCutoff = new Date(now.getTime() - 5 * 60_000);
    const [api, jobs, runtimeJobs, outbox, automationsFailed, privacy, privacyOverdue, staleJobs, staleOutbox, qualityFreshness, latestWorkerAttempt, slaCycles, loginFailures, poolRows] = await Promise.all([
      options.database.telemetryRecord.findMany({ where: { workspaceId, operation: { startsWith: "api." }, occurredAt: { gte: dayAgo } }, select: { outcome: true, durationMs: true } }),
      options.database.job.groupBy({ by: ["status"], where: { workspaceId, finishedAt: { gte: dayAgo } }, _count: { _all: true } }),
      options.database.job.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true }, _sum: { attempts: true } }),
      options.database.outboxEvent.groupBy({ by: ["status"], where: { workspaceId, createdAt: { gte: dayAgo } }, _count: { _all: true } }),
      options.database.automationRun.count({ where: { workspaceId, status: "FAILED", createdAt: { gte: dayAgo } } }),
      options.database.dataSubjectRequest.findMany({ where: { workspaceId, OR: [{ completedAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60_000) } }, { status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } }] }, select: { status: true, dueAt: true, completedAt: true } }),
      options.database.dataSubjectRequest.count({ where: { workspaceId, dueAt: { lt: now }, status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } } }),
      options.database.job.count({ where: { workspaceId, status: { in: ["PENDING", "RUNNING"] }, runAt: { lt: staleCutoff } } }),
      options.database.outboxEvent.count({ where: { workspaceId, status: { in: ["PENDING", "PROCESSING", "RETRY_PENDING"] }, availableAt: { lt: staleCutoff } } }),
      options.database.dataQualityScanRun.findFirst({ where: { workspaceId, status: "COMPLETED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
      options.database.automationAttempt.findFirst({ where: { workspaceId }, orderBy: { startedAt: "desc" }, select: { startedAt: true, finishedAt: true, status: true, workerId: true } }),
      options.database.leadSlaCycle.findMany({ where: { workspaceId, receivedAt: { gte: dayAgo } }, select: { receivedAt: true, firstHumanAttemptAt: true, firstHumanAttemptSeconds: true } }),
      options.database.auditLog.count({ where: { workspaceId, action: "auth.login.failed", occurredAt: { gte: dayAgo } } }),
      options.database.$queryRaw<Array<{ total: bigint; active: bigint }>>`
        SELECT
          count(*) FILTER (WHERE datname = current_database())::bigint AS total,
          count(*) FILTER (WHERE datname = current_database() AND state = 'active')::bigint AS active
        FROM pg_stat_activity
      `,
    ]);
    const jobTotal = jobs.reduce((sum, row) => sum + row._count._all, 0);
    const jobGood = jobs.find((row) => row.status === "SUCCEEDED")?._count._all ?? 0;
    const outboxTerminal = outbox.filter((row) => ["DELIVERED_LOCAL", "DEAD_LETTER", "CANCELLED"].includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
    const outboxGood = outbox.find((row) => row.status === "DELIVERED_LOCAL")?._count._all ?? 0;
    const privacyTerminal = privacy.filter((item) => item.completedAt);
    const privacyGood = privacyTerminal.filter((item) => item.dueAt && item.completedAt && item.completedAt <= item.dueAt).length;
    const runtimeByStatus = Object.fromEntries(runtimeJobs.map((row) => [row.status, row._count._all]));
    const pendingJobs = (runtimeByStatus.PENDING ?? 0) + (runtimeByStatus.RUNNING ?? 0);
    const retryAttempts = runtimeJobs.reduce((sum, row) => sum + Number(row._sum.attempts ?? 0), 0);
    const workerFresh = latestWorkerAttempt
      ? now.getTime() - latestWorkerAttempt.startedAt.getTime() <= 5 * 60_000
      : false;
    const workerState = pendingJobs === 0 ? "IDLE" : workerFresh ? "ACTIVE" : "STOPPED";
    const slaHealthy = slaCycles.filter((item) => item.firstHumanAttemptSeconds !== null && item.firstHumanAttemptSeconds <= 60).length;
    const slaAttention = slaCycles.filter((item) => item.firstHumanAttemptSeconds !== null && item.firstHumanAttemptSeconds > 60 && item.firstHumanAttemptSeconds <= 180).length;
    const slaWithoutAttempt = slaCycles.filter((item) => item.firstHumanAttemptAt === null).length;
    const slaCritical = slaCycles.filter((item) => item.firstHumanAttemptSeconds !== null
      ? item.firstHumanAttemptSeconds > 180
      : now.getTime() - item.receivedAt.getTime() > 180_000).length;
    const apiErrors = api.filter((item) => item.outcome === "ERROR").length;
    return {
      now,
      dayAgo,
      slo: {
        "api-availability": calculateSlo({ good: api.filter((item) => item.outcome !== "ERROR").length, total: api.length, targetBasisPoints: 9900 }),
        "api-latency": calculateSlo({ good: api.filter((item) => item.durationMs !== null && item.durationMs <= 1_000).length, total: api.filter((item) => item.durationMs !== null).length, targetBasisPoints: 9500 }),
        jobs: calculateSlo({ good: jobGood, total: jobTotal, targetBasisPoints: 9900 }),
        outbox: calculateSlo({ good: outboxGood, total: outboxTerminal, targetBasisPoints: 9900 }),
        "privacy-sla": calculateSlo({ good: privacyGood, total: privacyTerminal.length, targetBasisPoints: 9999 }),
      },
      alertValues: { "jobs.stale": staleJobs, "outbox.stale": staleOutbox, "automations.failed": automationsFailed, "privacy.overdue": privacyOverdue, "api.errors": apiErrors, "auth.login.failed": loginFailures, "jobs.dead_letter": runtimeByStatus.FAILED ?? 0, "worker.stale": workerState === "STOPPED" ? 1 : 0, "sla.critical": slaCritical },
      runtime: {
        api: { total: api.length, errors: apiErrors, denied: api.filter((item) => item.outcome === "DENIED").length },
        databasePool: { total: Number(poolRows[0]?.total ?? 0n), active: Number(poolRows[0]?.active ?? 0n), source: "pg_stat_activity" as const },
        jobs: { pending: runtimeByStatus.PENDING ?? 0, running: runtimeByStatus.RUNNING ?? 0, retries: retryAttempts, deadLetter: runtimeByStatus.FAILED ?? 0 },
        worker: { state: workerState, lastAttemptAt: latestWorkerAttempt?.startedAt.toISOString() ?? null },
        sla: { healthy: slaHealthy, attention: slaAttention, critical: slaCritical, withoutAttempt: slaWithoutAttempt },
        loginFailures,
        costAndUsage: { source: "provider-consoles" as const, automaticBudgetAlert: false, reason: "Planos gratuitos não expõem orçamento configurável no CRM." },
        slowQueries: { source: "provider-console" as const, availableInApplication: false },
      },
      freshness: { lastDataQualityScanAt: qualityFreshness?.finishedAt?.toISOString() ?? null, status: !qualityFreshness?.finishedAt ? "NO_DATA" : now.getTime() - qualityFreshness.finishedAt.getTime() > 24 * 60 * 60_000 ? "STALE" : "CURRENT" },
    };
  }

  async function auditIntegrity(workspaceId: string) {
    const [orphanRows, triggerRows] = await Promise.all([
      options.database.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM audit_logs l LEFT JOIN actors a ON a.id = l."actorId" AND a."workspaceId" = l."workspaceId" WHERE l."workspaceId" = ${workspaceId}::uuid AND a.id IS NULL`,
      options.database.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_trigger WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal AND tgname IN ('audit_logs_no_update_or_delete_trigger', 'audit_logs_no_truncate_trigger')`,
    ]);
    const orphanActors = Number(orphanRows[0]?.count ?? 0n);
    const immutableTriggers = Number(triggerRows[0]?.count ?? 0n);
    return { valid: orphanActors === 0 && immutableTriggers === 2, orphanActors, immutableTriggers, checkedAt: options.now().toISOString() };
  }

  async function getScreen(context: AuthenticatedContext, query: OperationsListQuery = { page: 1, pageSize: 25, tab: "observability" }) {
    await authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_READ, workspaceResource(context));
    assertSafeOperationalRuntime();
    await ensureFoundation(context);
    const samples = await sampleMetrics(context.workspaceId);
    const [canManage, canSeeSecurity, canManagePrivacy] = await Promise.all([
      authorization.authorize(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context)),
      authorization.authorize(context, PermissionKeys.SECURITY_MONITOR_READ, workspaceResource(context)),
      authorization.authorize(context, PermissionKeys.PRIVACY_OPERATIONS_MANAGE, workspaceResource(context)),
    ]);
    const skip = (query.page - 1) * query.pageSize;
    const [workspace, definitions, rules, alerts, alertTotal, incidents, incidentTotal, telemetryCounts, securityEvents, integrity, resilienceEvidence] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } }),
      options.database.sloDefinitionVersion.findMany({ where: { workspaceId: context.workspaceId, active: true }, orderBy: { key: "asc" } }),
      options.database.observabilityRuleVersion.findMany({ where: { workspaceId: context.workspaceId, active: true }, orderBy: { severity: "desc" } }),
      options.database.observabilityAlert.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ status: "asc" }, { severity: "desc" }, { lastDetectedAt: "desc" }], skip, take: query.pageSize, include: { ruleVersion: { select: { key: true, runbookKey: true } }, events: { orderBy: { occurredAt: "desc" }, take: 5 } } }),
      options.database.observabilityAlert.count({ where: { workspaceId: context.workspaceId } }),
      options.database.operationalIncident.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ status: "asc" }, { startedAt: "desc" }], skip, take: query.pageSize, include: { events: { orderBy: { occurredAt: "desc" }, take: 5 }, alerts: { select: { alertId: true } } } }),
      options.database.operationalIncident.count({ where: { workspaceId: context.workspaceId } }),
      options.database.telemetryRecord.groupBy({ by: ["kind", "outcome"], where: { workspaceId: context.workspaceId, occurredAt: { gte: samples.dayAgo } }, _count: { _all: true } }),
      canSeeSecurity.allowed
        ? options.database.auditLog.groupBy({ by: ["action"], where: { workspaceId: context.workspaceId, occurredAt: { gte: samples.dayAgo }, OR: [{ action: { startsWith: "auth." } }, { action: "authorization.denied" }, { action: { startsWith: "workspace.member." } }, { action: { startsWith: "privacy." } }, { action: { startsWith: "operations." } }] }, _count: { _all: true } })
        : Promise.resolve([]),
      canSeeSecurity.allowed ? auditIntegrity(context.workspaceId) : Promise.resolve(null),
      options.database.telemetryRecord.findMany({ where: { workspaceId: context.workspaceId, operation: { in: ["resilience.restore.completed", "resilience.load.completed", "resilience.invariants.completed"] } }, orderBy: { occurredAt: "desc" }, take: 20, select: { operation: true, outcome: true, occurredAt: true, durationMs: true, metadata: true } }),
    ]);
    const privacy = canManagePrivacy.allowed
      ? await Promise.all([
        options.database.dataSubjectRequest.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ status: "asc" }, { requestedAt: "desc" }], skip, take: query.pageSize, include: { contact: { select: { preferredName: true, legalName: true } }, events: { orderBy: { occurredAt: "desc" }, take: 5 } } }),
        options.database.dataSubjectRequest.count({ where: { workspaceId: context.workspaceId } }),
        options.database.legalHold.count({ where: { workspaceId: context.workspaceId, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: samples.now } }] } }),
        options.database.dataCategory.findMany({ where: { workspaceId: context.workspaceId, active: true }, orderBy: [{ sensitivity: "desc" }, { code: "asc" }], take: 50, select: { id: true, code: true, version: true, name: true, sensitivity: true, sourceSystems: true } }),
        options.database.processingPurpose.findMany({ where: { workspaceId: context.workspaceId, active: true }, orderBy: { code: "asc" }, take: 50, include: { versions: { orderBy: { version: "desc" }, take: 1, include: { legalBasis: { select: { name: true, basisType: true, status: true } } } } } }),
        options.database.retentionPolicy.findMany({ where: { workspaceId: context.workspaceId, active: true }, orderBy: { code: "asc" }, take: 50, include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, trigger: true, durationDays: true, action: true, status: true, ownerMemberId: true } } } }),
      ])
      : null;
    return {
      contractVersion: OPERATIONS_API_VERSION,
      generatedAt: samples.now.toISOString(),
      timeZone: workspace.timeZone,
      localOnly: process.env.APP_ENV !== "staging" && process.env.APP_ENV !== "production",
      externalEgress: false,
      window: { from: samples.dayAgo.toISOString(), to: samples.now.toISOString() },
      slos: definitions.map((definition) => ({ ...definition, threshold: undefined, result: samples.slo[definition.key as keyof typeof samples.slo] ?? null })),
      rules: rules.map((rule) => ({ ...rule, threshold: Number(rule.threshold) })),
      alerts,
      incidents,
      telemetryCounts,
      runtime: samples.runtime,
      security: canSeeSecurity.allowed && integrity ? { events: securityEvents, auditIntegrity: integrity, threatModelVersion: "threat-model.v1" } : null,
      privacy: privacy ? { requests: privacy[0], totalRequests: privacy[1], activeLegalHolds: privacy[2], inventory: { categories: privacy[3], purposes: privacy[4], retentionPolicies: privacy[5] }, overdue: samples.alertValues["privacy.overdue"], destructiveExecutionEnabled: false } : null,
      freshness: samples.freshness,
      resilience: {
        contractVersion: RESILIENCE_CONTRACT_VERSION,
        catalog: criticalityCatalog,
        latestRestore: resilienceEvidence.find((item) => item.operation === "resilience.restore.completed") ?? null,
        latestLoad: resilienceEvidence.find((item) => item.operation === "resilience.load.completed") ?? null,
        latestInvariants: resilienceEvidence.find((item) => item.operation === "resilience.invariants.completed") ?? null,
        destructivePublicTests: false,
        externalEgress: false,
      },
      pagination: { page: query.page, pageSize: query.pageSize, alertTotal, incidentTotal, privacyTotal: privacy?.[1] ?? 0 },
      permissions: { canManage: canManage.allowed, canSeeSecurity: canSeeSecurity.allowed, canManagePrivacy: canManagePrivacy.allowed },
    };
  }

  async function evaluateAlerts(context: AuthenticatedContext, correlationId: string) {
    await authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context));
    assertSafeOperationalRuntime();
    await ensureFoundation(context);
    const samples = await sampleMetrics(context.workspaceId);
    return options.database.$transaction(async (tx) => {
      const rules = await tx.observabilityRuleVersion.findMany({ where: { workspaceId: context.workspaceId, active: true } });
      const results = [];
      for (const rule of rules) {
        const value = samples.alertValues[rule.metricKey as keyof typeof samples.alertValues];
        if (value === undefined) continue;
        const dedupKey = `${rule.key}:active`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ops-alert:${context.workspaceId}:${dedupKey}`}, 0))`;
        const existing = await tx.observabilityAlert.findUnique({ where: { workspaceId_dedupKey: { workspaceId: context.workspaceId, dedupKey } } });
        if (value > Number(rule.threshold)) {
          if (existing && existing.lastDetectedAt.getTime() + rule.cooldownSeconds * 1_000 > samples.now.getTime()) { results.push({ id: existing.id, outcome: "COOLDOWN", value }); continue; }
          const alert = existing
            ? await tx.observabilityAlert.update({ where: { id: existing.id }, data: { status: "OPEN", severity: rule.severity, summary: `${value} ocorrência(s) acima do limite ${rule.threshold}.`, evidence: { metricKey: rule.metricKey, value, threshold: Number(rule.threshold), observedAt: samples.now.toISOString() }, correlationId, lastDetectedAt: samples.now, resolvedAt: null, revision: { increment: 1 } } })
            : await tx.observabilityAlert.create({ data: { workspaceId: context.workspaceId, ruleVersionId: rule.id, dedupKey, status: "OPEN", severity: rule.severity, title: rule.name, summary: `${value} ocorrência(s) acima do limite ${rule.threshold}.`, owner: rule.owner, queueId: rule.queueId, evidence: { metricKey: rule.metricKey, value, threshold: Number(rule.threshold), observedAt: samples.now.toISOString() }, correlationId, firstDetectedAt: samples.now, lastDetectedAt: samples.now } });
          await tx.observabilityAlertEvent.create({ data: { workspaceId: context.workspaceId, alertId: alert.id, action: existing ? "REOPENED" : "DETECTED", reason: "Regra determinística local excedeu o limiar.", evidence: { metricKey: rule.metricKey, value }, actorId: context.actorId } });
          results.push({ id: alert.id, outcome: existing ? "REOPENED" : "CREATED", value });
        } else if (existing && existing.status !== "RESOLVED") {
          const resolved = await tx.observabilityAlert.update({ where: { id: existing.id }, data: { status: "RESOLVED", resolvedAt: samples.now, lastDetectedAt: samples.now, revision: { increment: 1 } } });
          await tx.observabilityAlertEvent.create({ data: { workspaceId: context.workspaceId, alertId: existing.id, action: "AUTO_RESOLVED", reason: "Métrica voltou ao limite seguro.", evidence: { metricKey: rule.metricKey, value }, actorId: context.actorId } });
          results.push({ id: resolved.id, outcome: "RESOLVED", value });
        }
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "operations.alerts.evaluated_local", entityType: "Workspace", entityId: context.workspaceId, requestId: correlationId, changes: { evaluatedRules: rules.length, resultingActions: results.length, externalEgress: false } } });
      return { results, correlationId, externalEgress: false as const };
    });
  }

  async function alertAction(context: AuthenticatedContext, input: Readonly<{ alertId: string; reason: string; revision: number; status: "ACKNOWLEDGED" | "RESOLVED" }>) {
    await authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context));
    return options.database.$transaction(async (tx) => {
      const alert = await tx.observabilityAlert.findFirst({ where: { id: input.alertId, workspaceId: context.workspaceId } });
      if (!alert) fail("Alerta não encontrado.", "ALERT_NOT_FOUND", 404);
      const changed = await tx.observabilityAlert.updateMany({ where: { id: alert.id, workspaceId: context.workspaceId, revision: input.revision }, data: { status: input.status, acknowledgedAt: input.status === "ACKNOWLEDGED" ? options.now() : alert.acknowledgedAt, resolvedAt: input.status === "RESOLVED" ? options.now() : null, revision: { increment: 1 } } });
      if (changed.count !== 1) fail("O alerta foi alterado por outro usuário. Atualize e tente novamente.", "STALE_ALERT", 409);
      await tx.observabilityAlertEvent.create({ data: { workspaceId: context.workspaceId, alertId: alert.id, action: input.status, reason: input.reason, evidence: { previousStatus: alert.status, nextStatus: input.status }, actorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `operations.alert.${input.status.toLowerCase()}`, entityType: "ObservabilityAlert", entityId: alert.id, reason: input.reason, changes: { from: alert.status, to: input.status } } });
      return { id: alert.id, status: input.status, revision: input.revision + 1 };
    });
  }

  async function createIncident(context: AuthenticatedContext, input: Readonly<{ alertId: string; title: string; impact: string; owner: string; reason: string; idempotencyKey: string }>) {
    await authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ops-incident:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      const existing = await tx.operationalIncident.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return existing;
      const alert = await tx.observabilityAlert.findFirst({ where: { id: input.alertId, workspaceId: context.workspaceId } });
      if (!alert) fail("Alerta não encontrado.", "ALERT_NOT_FOUND", 404);
      const incident = await tx.operationalIncident.create({ data: { workspaceId: context.workspaceId, status: "OPEN", severity: alert.severity, title: input.title, summary: alert.summary, impact: input.impact, owner: input.owner, queueId: alert.queueId, runbookKey: "runbook-triage", correlationId: alert.correlationId, idempotencyKey: input.idempotencyKey, startedAt: options.now(), createdByActorId: context.actorId } });
      await tx.operationalIncidentAlert.create({ data: { workspaceId: context.workspaceId, incidentId: incident.id, alertId: alert.id } });
      await tx.operationalIncidentEvent.create({ data: { workspaceId: context.workspaceId, incidentId: incident.id, kind: "CREATED", toStatus: "OPEN", note: input.reason, evidence: { alertId: alert.id, severity: alert.severity }, actorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "operations.incident.created", entityType: "OperationalIncident", entityId: incident.id, reason: input.reason, changes: { alertId: alert.id, severity: alert.severity, owner: input.owner } } });
      return incident;
    });
  }

  async function transitionIncident(context: AuthenticatedContext, input: Readonly<{ incidentId: string; toStatus: "INVESTIGATING" | "MITIGATED" | "RESOLVED"; note: string; revision: number }>) {
    await authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, workspaceResource(context));
    const allowed = { OPEN: ["INVESTIGATING", "MITIGATED", "RESOLVED"], INVESTIGATING: ["MITIGATED", "RESOLVED"], MITIGATED: ["INVESTIGATING", "RESOLVED"], RESOLVED: [] } as const;
    return options.database.$transaction(async (tx) => {
      const incident = await tx.operationalIncident.findFirst({ where: { id: input.incidentId, workspaceId: context.workspaceId } });
      if (!incident) fail("Incidente não encontrado.", "INCIDENT_NOT_FOUND", 404);
      if (!(allowed[incident.status] as readonly string[]).includes(input.toStatus)) fail("Transição inválida para o incidente.", "INVALID_INCIDENT_TRANSITION");
      const changed = await tx.operationalIncident.updateMany({ where: { id: incident.id, workspaceId: context.workspaceId, revision: input.revision }, data: { status: input.toStatus, mitigatedAt: input.toStatus === "MITIGATED" ? options.now() : incident.mitigatedAt, resolvedAt: input.toStatus === "RESOLVED" ? options.now() : null, revision: { increment: 1 } } });
      if (changed.count !== 1) fail("O incidente foi alterado por outro usuário.", "STALE_INCIDENT");
      await tx.operationalIncidentEvent.create({ data: { workspaceId: context.workspaceId, incidentId: incident.id, kind: input.toStatus === "RESOLVED" ? "RESOLVED" : "STATUS_CHANGED", fromStatus: incident.status, toStatus: input.toStatus, note: input.note, evidence: { revision: input.revision }, actorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "operations.incident.transitioned", entityType: "OperationalIncident", entityId: incident.id, reason: input.note, changes: { from: incident.status, to: input.toStatus } } });
      return { id: incident.id, status: input.toStatus, revision: input.revision + 1 };
    });
  }

  async function createDsr(context: AuthenticatedContext, input: Readonly<{ leadId: string; type: "ACCESS" | "CORRECTION" | "PORTABILITY" | "RESTRICTION" | "OPPOSITION" | "REVOCATION" | "DELETION"; categoryIds: string[]; reason: string; idempotencyKey: string }>) {
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_OPERATIONS_MANAGE, workspaceResource(context));
    const { getPrivacyService } = await import("@/modules/privacy/application/privacy-service");
    return getPrivacyService().createDsr(context, { ...input, receivedChannel: "OTHER" });
  }

  async function previewDestruction(context: AuthenticatedContext, input: Readonly<{ requestId: string; reason: string; idempotencyKey: string }>) {
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_OPERATIONS_MANAGE, workspaceResource(context));
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-destruction:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      const existing = await tx.retentionAction.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return existing;
      const request = await tx.dataSubjectRequest.findFirst({ where: { id: input.requestId, workspaceId: context.workspaceId }, include: { categories: true } });
      if (!request) fail("Solicitação não encontrada.", "DSR_NOT_FOUND", 404);
      const holdCount = await tx.legalHold.count({ where: { workspaceId: context.workspaceId, status: "ACTIVE", OR: [{ contactId: request.contactId }, { requestId: request.id }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: options.now() } }] }] } });
      const policy = await tx.retentionPolicyVersion.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: [{ version: "desc" }, { createdAt: "desc" }] });
      const blockerCodes = [
        ...(request.verificationStatus !== "VERIFIED" ? ["IDENTITY_NOT_VERIFIED"] : []),
        ...(holdCount > 0 ? ["ACTIVE_LEGAL_HOLD"] : []),
        ...(!policy || policy.status !== "ACTIVE" ? ["POLICY_NOT_ACTIVE"] : []),
        "IMMUTABLE_COMMERCIAL_AND_AUDIT_FACTS",
        "HUMAN_APPROVAL_REQUIRED",
      ];
      const action = await tx.retentionAction.create({ data: { workspaceId: context.workspaceId, retentionPolicyVersionId: policy?.id ?? null, contactId: request.contactId, requestId: request.id, action: "DELETE_WHEN_ALLOWED", status: "BLOCKED", preview: { dryRun: true, destructiveExecution: false, categoryCount: request.categories.length, preserves: ["audit_logs", "commercial_ledgers", "financial_facts", "historical_events"] }, blockerCodes, reason: input.reason, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId } });
      await tx.dataSubjectRequestEvent.create({ data: { workspaceId: context.workspaceId, requestId: request.id, kind: "DESTRUCTION_PREVIEWED", reason: input.reason, evidence: { blockerCodes, holdCount, policyVersionId: policy?.id ?? null }, result: { retentionActionId: action.id, destructiveExecution: false }, actorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.destruction.previewed", entityType: "DataSubjectRequest", entityId: request.id, reason: input.reason, changes: { retentionActionId: action.id, blockerCodes, destructiveExecution: false } } });
      return action;
    });
  }

  async function runRetentionCheckpoint(context: AuthenticatedContext, input: Readonly<{ idempotencyKey: string; batchSize: number }>) {
    await authorization.assertAuthorized(context, PermissionKeys.PRIVACY_OPERATIONS_MANAGE, workspaceResource(context));
    assertSafeOperationalRuntime();
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`privacy-checkpoint:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      const existing = await tx.job.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return existing;
      const candidates = await tx.dataSubjectRequest.findMany({ where: { workspaceId: context.workspaceId, status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] }, dueAt: { lte: options.now() } }, orderBy: { dueAt: "asc" }, take: input.batchSize, select: { id: true, contactId: true, dueAt: true } });
      const job = await tx.job.create({ data: { workspaceId: context.workspaceId, type: "PRIVACY_RETENTION_CHECKPOINT", status: "SUCCEEDED", idempotencyKey: input.idempotencyKey, runAt: options.now(), payload: { dryRun: true, batchSize: input.batchSize }, result: { candidates: candidates.map((item) => ({ requestId: item.id, dueAt: item.dueAt?.toISOString() ?? null })), candidateCount: candidates.length, destructiveExecution: false }, createdByActorId: context.actorId, updatedByActorId: context.actorId, finishedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "privacy.retention.checkpoint.completed_local", entityType: "Job", entityId: job.id, requestId: input.idempotencyKey, changes: { candidateCount: candidates.length, batchSize: input.batchSize, dryRun: true, destructiveExecution: false } } });
      return job;
    });
  }

  return Object.freeze({ getScreen, recordTelemetry, evaluateAlerts, alertAction, createIncident, transitionIncident, createDsr, previewDestruction, runRetentionCheckpoint, auditIntegrity });
}

let singleton: ReturnType<typeof createOperationsService> | undefined;
export function getOperationsService() {
  singleton ??= createOperationsService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}

export function operationsCorrelationId(prefix = "ops") {
  return `${prefix}:${randomUUID()}`;
}
