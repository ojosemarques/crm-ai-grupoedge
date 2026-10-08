import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const DAY_MS = 86_400_000;

type FindingSeverity = "ATTENTION" | "CRITICAL";
export type ProspectingReconciliationFinding = Readonly<{
  code: string;
  severity: FindingSeverity;
  count: number;
  entityType: string;
  entityId: string | null;
  message: string;
  action: string;
}>;

type ReconciliationFacts = Readonly<{
  releasedCandidatesMissingLead: bigint;
  releasedCandidateId: string | null;
  releasedReleasesMissingLead: bigint;
  releasedReleaseId: string | null;
  terminalCadencesWithOpenTasks: bigint;
  terminalCadenceTaskId: string | null;
  terminalCadencesWithPendingEmail: bigint;
  terminalCadenceEmailId: string | null;
  staleClaims: bigint;
  staleClaimId: string | null;
  sentWithoutProviderReceipt: bigint;
  sentWithoutProviderReceiptId: string | null;
  emailFailures: bigint;
  emailFailureId: string | null;
  highRetryJobs: bigint;
  highRetryJobId: string | null;
  bouncesOrComplaints: bigint;
  bounceOrComplaintId: string | null;
  activeLeadsWithoutRouting: bigint;
  activeLeadWithoutRoutingId: string | null;
  readyCandidatesWithStaleSources: bigint;
  readyCandidateWithStaleSourceId: string | null;
  lastResearchAt: Date | null;
  lastEmailAt: Date | null;
}>;

type DueWorkspace = Readonly<{ workspaceId: string }>;
type MissingInstagramContact = Readonly<{
  candidateId: string;
  workspaceId: string;
  contactId: string;
  instagram: string;
  instagramScope: "POLITICIAN" | "ADVISOR" | "OFFICE";
  mandateVerifiedAt: Date;
  doNotContact: boolean;
}>;

function contactScopeLabel(scope: MissingInstagramContact["instagramScope"]): string {
  if (scope === "POLITICIAN") return "Direto";
  if (scope === "ADVISOR") return "Assessoria";
  return "Gabinete";
}

function normalizeInstagram(value: string): string {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function finding(
  collection: ProspectingReconciliationFinding[],
  input: Omit<ProspectingReconciliationFinding, "count"> & Readonly<{ count: bigint }>,
) {
  const count = Number(input.count);
  if (count <= 0) return;
  collection.push(Object.freeze({ ...input, count }));
}

function findingsHash(findings: readonly ProspectingReconciliationFinding[]): string {
  return createHash("sha256").update(JSON.stringify(findings)).digest("hex");
}

export function createProspectingReconciliationService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  async function repairMissingInstagramContacts(workerId: string) {
    const now = options.now();
    return options.database.$transaction(async (database) => {
      const candidates = await database.$queryRaw<MissingInstagramContact[]>(Prisma.sql`
        SELECT
          candidate."id" AS "candidateId",
          candidate."workspaceId",
          lead."contactId",
          candidate."instagram",
          candidate."instagramScope"::text AS "instagramScope",
          candidate."mandateVerifiedAt",
          (lead."contactPreference"::text = 'DO_NOT_CONTACT') AS "doNotContact"
        FROM "prospect_candidates" candidate
        JOIN "leads" lead
          ON lead."workspaceId" = candidate."workspaceId" AND lead."id" = candidate."leadId"
        WHERE candidate."status"::text = 'RELEASED'
          AND candidate."instagram" IS NOT NULL
          AND BTRIM(candidate."instagram") <> ''
          AND candidate."instagramScope" IS NOT NULL
          AND lead."contactId" IS NOT NULL
          AND lead."deletedAt" IS NULL
          AND EXISTS (
            SELECT 1 FROM "actors" actor
            WHERE actor."workspaceId" = candidate."workspaceId"
              AND actor."type"::text = 'SYSTEM'
              AND actor."key" = 'system'
              AND actor."userId" IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM "contact_points" point
            WHERE point."workspaceId" = candidate."workspaceId"
              AND point."contactId" = lead."contactId"
              AND point."type"::text = 'INSTAGRAM'
              AND point."normalizedValue" = LOWER(BTRIM(candidate."instagram"))
              AND point."deletedAt" IS NULL
          )
        ORDER BY candidate."releasedAt" ASC NULLS FIRST, candidate."id" ASC
        LIMIT 100
        FOR UPDATE OF candidate SKIP LOCKED
      `);
      if (candidates.length === 0) return { status: "IDLE" as const, repaired: 0 };

      const actorIds = new Map<string, string>();
      for (const candidate of candidates) {
        let actorId = actorIds.get(candidate.workspaceId);
        if (!actorId) {
          const actor = await database.actor.findFirstOrThrow({
            where: { workspaceId: candidate.workspaceId, type: "SYSTEM", key: "system", userId: null },
            select: { id: true },
          });
          actorId = actor.id;
          actorIds.set(candidate.workspaceId, actorId);
        }
        const contactPoint = await database.contactPoint.create({
          data: {
            workspaceId: candidate.workspaceId,
            contactId: candidate.contactId,
            type: "INSTAGRAM",
            originalValue: candidate.instagram,
            normalizedValue: normalizeInstagram(candidate.instagram),
            label: contactScopeLabel(candidate.instagramScope),
            verificationStatus: "VERIFIED",
            quality: "VALID",
            source: "LEAD_INTAKE",
            doNotContact: candidate.doNotContact,
            verifiedAt: candidate.mandateVerifiedAt,
            createdByActorId: actorId,
            updatedByActorId: actorId,
          },
          select: { id: true },
        });
        await database.auditLog.create({
          data: {
            workspaceId: candidate.workspaceId,
            actorId,
            action: "prospecting.instagram_contact.repaired",
            entityType: "ProspectCandidate",
            entityId: candidate.candidateId,
            origin: "SYSTEM",
            requestId: workerId,
            occurredAt: now,
            changes: { contactPointId: contactPoint.id, type: "INSTAGRAM", externalEgress: false },
          },
        });
      }
      return { status: "INSTAGRAM_CONTACTS_REPAIRED" as const, repaired: candidates.length };
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 30_000 });
  }

  async function collect(database: Prisma.TransactionClient, workspaceId: string, now: Date) {
    const staleSourceCutoff = new Date(now.getTime() - 30 * DAY_MS);
    const recentDeliveryCutoff = new Date(now.getTime() - 30 * DAY_MS);
    const [facts] = await database.$queryRaw<ReconciliationFacts[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "prospect_candidates" candidate
          WHERE candidate."workspaceId" = ${workspaceId}::uuid
            AND candidate."status"::text = 'RELEASED' AND candidate."leadId" IS NULL)::bigint AS "releasedCandidatesMissingLead",
        (SELECT MIN(candidate."id"::text) FROM "prospect_candidates" candidate
          WHERE candidate."workspaceId" = ${workspaceId}::uuid
            AND candidate."status"::text = 'RELEASED' AND candidate."leadId" IS NULL) AS "releasedCandidateId",
        (SELECT COUNT(*) FROM "prospect_releases" release
          WHERE release."workspaceId" = ${workspaceId}::uuid
            AND release."status"::text = 'RELEASED' AND release."leadId" IS NULL)::bigint AS "releasedReleasesMissingLead",
        (SELECT MIN(release."id"::text) FROM "prospect_releases" release
          WHERE release."workspaceId" = ${workspaceId}::uuid
            AND release."status"::text = 'RELEASED' AND release."leadId" IS NULL) AS "releasedReleaseId",
        (SELECT COUNT(*) FROM "tasks" task
          JOIN "prospecting_cadence_instances" cadence
            ON cadence."workspaceId" = task."workspaceId" AND cadence."leadId" = task."leadId"
          WHERE task."workspaceId" = ${workspaceId}::uuid
            AND cadence."status"::text IN ('CONVERSATION_STARTED', 'MEETING_SCHEDULED', 'CLOSED_NO_RESPONSE', 'DISCARDED', 'CANCELLED')
            AND task."sourceKey" LIKE 'active-prospecting:%'
            AND task."status"::text IN ('OPEN', 'IN_PROGRESS') AND task."deletedAt" IS NULL)::bigint AS "terminalCadencesWithOpenTasks",
        (SELECT MIN(task."id"::text) FROM "tasks" task
          JOIN "prospecting_cadence_instances" cadence
            ON cadence."workspaceId" = task."workspaceId" AND cadence."leadId" = task."leadId"
          WHERE task."workspaceId" = ${workspaceId}::uuid
            AND cadence."status"::text IN ('CONVERSATION_STARTED', 'MEETING_SCHEDULED', 'CLOSED_NO_RESPONSE', 'DISCARDED', 'CANCELLED')
            AND task."sourceKey" LIKE 'active-prospecting:%'
            AND task."status"::text IN ('OPEN', 'IN_PROGRESS') AND task."deletedAt" IS NULL) AS "terminalCadenceTaskId",
        (SELECT COUNT(*) FROM "prospecting_email_jobs" job
          JOIN "prospecting_cadence_instances" cadence
            ON cadence."workspaceId" = job."workspaceId" AND cadence."id" = job."cadenceInstanceId"
          WHERE job."workspaceId" = ${workspaceId}::uuid
            AND cadence."status"::text IN ('CONVERSATION_STARTED', 'MEETING_SCHEDULED', 'CLOSED_NO_RESPONSE', 'DISCARDED', 'CANCELLED')
            AND job."status"::text IN ('BLOCKED', 'SCHEDULED', 'CLAIMED', 'RECONCILIATION_REQUIRED'))::bigint AS "terminalCadencesWithPendingEmail",
        (SELECT MIN(job."id"::text) FROM "prospecting_email_jobs" job
          JOIN "prospecting_cadence_instances" cadence
            ON cadence."workspaceId" = job."workspaceId" AND cadence."id" = job."cadenceInstanceId"
          WHERE job."workspaceId" = ${workspaceId}::uuid
            AND cadence."status"::text IN ('CONVERSATION_STARTED', 'MEETING_SCHEDULED', 'CLOSED_NO_RESPONSE', 'DISCARDED', 'CANCELLED')
            AND job."status"::text IN ('BLOCKED', 'SCHEDULED', 'CLAIMED', 'RECONCILIATION_REQUIRED')) AS "terminalCadenceEmailId",
        (SELECT COUNT(*) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid AND job."status"::text = 'CLAIMED'
            AND job."leaseExpiresAt" < ${now})::bigint AS "staleClaims",
        (SELECT MIN(job."id"::text) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid AND job."status"::text = 'CLAIMED'
            AND job."leaseExpiresAt" < ${now}) AS "staleClaimId",
        (SELECT COUNT(*) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid AND job."status"::text = 'SENT'
            AND job."providerMessageId" IS NULL)::bigint AS "sentWithoutProviderReceipt",
        (SELECT MIN(job."id"::text) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid AND job."status"::text = 'SENT'
            AND job."providerMessageId" IS NULL) AS "sentWithoutProviderReceiptId",
        (SELECT COUNT(*) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid
            AND job."status"::text IN ('FAILED', 'RECONCILIATION_REQUIRED'))::bigint AS "emailFailures",
        (SELECT MIN(job."id"::text) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid
            AND job."status"::text IN ('FAILED', 'RECONCILIATION_REQUIRED')) AS "emailFailureId",
        (SELECT COUNT(*) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid AND job."attemptCount" >= 3
            AND job."status"::text NOT IN ('DELIVERED', 'REPLIED', 'CANCELLED', 'SUPPRESSED', 'EXPIRED'))::bigint AS "highRetryJobs",
        (SELECT MIN(job."id"::text) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid AND job."attemptCount" >= 3
            AND job."status"::text NOT IN ('DELIVERED', 'REPLIED', 'CANCELLED', 'SUPPRESSED', 'EXPIRED')) AS "highRetryJobId",
        (SELECT COUNT(*) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid
            AND job."status"::text IN ('BOUNCED', 'COMPLAINT') AND job."updatedAt" >= ${recentDeliveryCutoff})::bigint AS "bouncesOrComplaints",
        (SELECT MIN(job."id"::text) FROM "prospecting_email_jobs" job
          WHERE job."workspaceId" = ${workspaceId}::uuid
            AND job."status"::text IN ('BOUNCED', 'COMPLAINT') AND job."updatedAt" >= ${recentDeliveryCutoff}) AS "bounceOrComplaintId",
        (SELECT COUNT(*) FROM "leads" lead
          JOIN "pipelines" pipeline ON pipeline."workspaceId" = lead."workspaceId" AND pipeline."id" = lead."pipelineId"
          WHERE lead."workspaceId" = ${workspaceId}::uuid AND pipeline."name" = 'Prospecção Ativa'
            AND pipeline."deletedAt" IS NULL AND lead."deletedAt" IS NULL AND lead."status"::text = 'OPEN'
            AND ((lead."ownerMemberId" IS NULL AND lead."queueId" IS NULL AND lead."routingQueueId" IS NULL)
              OR lead."nextActionTaskId" IS NULL OR lead."nextActionAt" IS NULL))::bigint AS "activeLeadsWithoutRouting",
        (SELECT MIN(lead."id"::text) FROM "leads" lead
          JOIN "pipelines" pipeline ON pipeline."workspaceId" = lead."workspaceId" AND pipeline."id" = lead."pipelineId"
          WHERE lead."workspaceId" = ${workspaceId}::uuid AND pipeline."name" = 'Prospecção Ativa'
            AND pipeline."deletedAt" IS NULL AND lead."deletedAt" IS NULL AND lead."status"::text = 'OPEN'
            AND ((lead."ownerMemberId" IS NULL AND lead."queueId" IS NULL AND lead."routingQueueId" IS NULL)
              OR lead."nextActionTaskId" IS NULL OR lead."nextActionAt" IS NULL)) AS "activeLeadWithoutRoutingId",
        (SELECT COUNT(*) FROM "prospect_candidates" candidate
          WHERE candidate."workspaceId" = ${workspaceId}::uuid AND candidate."status"::text = 'READY'
            AND NOT EXISTS (SELECT 1 FROM "prospect_candidate_sources" source
              WHERE source."workspaceId" = candidate."workspaceId" AND source."candidateId" = candidate."id"
                AND source."field" IN ('role', 'mandate')
                AND source."sourceType"::text IN ('CITY_HALL', 'CITY_COUNCIL', 'OFFICIAL_GAZETTE')
                AND source."validationStatus"::text = 'VALID' AND source."observedAt" >= ${staleSourceCutoff}))::bigint AS "readyCandidatesWithStaleSources",
        (SELECT MIN(candidate."id"::text) FROM "prospect_candidates" candidate
          WHERE candidate."workspaceId" = ${workspaceId}::uuid AND candidate."status"::text = 'READY'
            AND NOT EXISTS (SELECT 1 FROM "prospect_candidate_sources" source
              WHERE source."workspaceId" = candidate."workspaceId" AND source."candidateId" = candidate."id"
                AND source."field" IN ('role', 'mandate')
                AND source."sourceType"::text IN ('CITY_HALL', 'CITY_COUNCIL', 'OFFICIAL_GAZETTE')
                AND source."validationStatus"::text = 'VALID' AND source."observedAt" >= ${staleSourceCutoff})) AS "readyCandidateWithStaleSourceId",
        (SELECT MAX(receipt."receivedAt") FROM "open_dot_request_receipts" receipt
          WHERE receipt."workspaceId" = ${workspaceId}::uuid
            AND receipt."scope"::text IN ('RESEARCH_WRITE', 'RESEARCH_REVIEW')) AS "lastResearchAt",
        (SELECT MAX(receipt."receivedAt") FROM "open_dot_request_receipts" receipt
          WHERE receipt."workspaceId" = ${workspaceId}::uuid
            AND receipt."scope"::text IN ('EMAIL_CLAIM', 'EMAIL_RECEIPT', 'EMAIL_EVENT_WRITE')) AS "lastEmailAt"
    `);
    if (!facts) throw new ApplicationError("A reconciliação não produziu fatos.", { code: "PROSPECTING_RECONCILIATION_EMPTY", statusCode: 500 });

    const findings: ProspectingReconciliationFinding[] = [];
    finding(findings, { code: "RELEASED_CANDIDATE_WITHOUT_LEAD", severity: "CRITICAL", count: facts.releasedCandidatesMissingLead, entityType: "ProspectCandidate", entityId: facts.releasedCandidateId, message: "Candidato liberado sem Lead correspondente.", action: "Bloquear novas liberações e reconciliar o candidato com o Lead." });
    finding(findings, { code: "RELEASE_WITHOUT_LEAD", severity: "CRITICAL", count: facts.releasedReleasesMissingLead, entityType: "ProspectRelease", entityId: facts.releasedReleaseId, message: "Liberação concluída sem Lead correspondente.", action: "Revisar a transação de liberação e o ledger de auditoria." });
    finding(findings, { code: "TERMINAL_CADENCE_WITH_OPEN_TASK", severity: "CRITICAL", count: facts.terminalCadencesWithOpenTasks, entityType: "Task", entityId: facts.terminalCadenceTaskId, message: "Cadência encerrada ainda possui tarefa fria aberta.", action: "Cancelar as tarefas residuais antes de retomar a cadência." });
    finding(findings, { code: "TERMINAL_CADENCE_WITH_PENDING_EMAIL", severity: "CRITICAL", count: facts.terminalCadencesWithPendingEmail, entityType: "ProspectingEmailJob", entityId: facts.terminalCadenceEmailId, message: "Cadência encerrada ainda possui ordem de e-mail pendente.", action: "Manter o egress bloqueado e cancelar a ordem residual." });
    finding(findings, { code: "STALE_EMAIL_CLAIM", severity: "CRITICAL", count: facts.staleClaims, entityType: "ProspectingEmailJob", entityId: facts.staleClaimId, message: "Ordem de e-mail permanece reivindicada após o vencimento do lease.", action: "Reconciliar o provider antes de reprocessar." });
    finding(findings, { code: "SENT_EMAIL_WITHOUT_PROVIDER_RECEIPT", severity: "CRITICAL", count: facts.sentWithoutProviderReceipt, entityType: "ProspectingEmailJob", entityId: facts.sentWithoutProviderReceiptId, message: "Ordem marcada como enviada sem identificador do provider.", action: "Confirmar o envio no provider e registrar receipt ou falha." });
    finding(findings, { code: "EMAIL_FAILURE_OR_RECONCILIATION_REQUIRED", severity: "CRITICAL", count: facts.emailFailures, entityType: "ProspectingEmailJob", entityId: facts.emailFailureId, message: "Há ordens de e-mail com falha ou reconciliação obrigatória.", action: "Resolver a causa e registrar a decisão antes de qualquer replay." });
    finding(findings, { code: "EMAIL_RETRY_PRESSURE", severity: "ATTENTION", count: facts.highRetryJobs, entityType: "ProspectingEmailJob", entityId: facts.highRetryJobId, message: "Há ordens de e-mail com três ou mais tentativas.", action: "Revisar conectividade, reputação e limites do remetente." });
    finding(findings, { code: "EMAIL_BOUNCE_OR_COMPLAINT", severity: "CRITICAL", count: facts.bouncesOrComplaints, entityType: "ProspectingEmailJob", entityId: facts.bounceOrComplaintId, message: "Houve bounce ou complaint nos últimos 30 dias.", action: "Aplicar supressão e revisar reputação e qualidade das fontes." });
    finding(findings, { code: "ACTIVE_LEAD_WITHOUT_ROUTING_OR_NEXT_ACTION", severity: "CRITICAL", count: facts.activeLeadsWithoutRouting, entityType: "Lead", entityId: facts.activeLeadWithoutRoutingId, message: "Lead ativo está sem responsável/fila ou sem próxima ação válida.", action: "Atribuir responsável e criar a próxima ação antes de continuar." });
    finding(findings, { code: "READY_CANDIDATE_WITH_STALE_SOURCE", severity: "ATTENTION", count: facts.readyCandidatesWithStaleSources, entityType: "ProspectCandidate", entityId: facts.readyCandidateWithStaleSourceId, message: "Candidato READY não possui fonte observada nos últimos 30 dias.", action: "Revalidar as fontes oficiais antes do planejamento." });

    const heartbeatCutoff = new Date(now.getTime() - DAY_MS);
    if (!facts.lastResearchAt || facts.lastResearchAt < heartbeatCutoff) {
      findings.push({ code: "RESEARCH_HEARTBEAT_STALE", severity: "ATTENTION", count: 1, entityType: "OpenDotClient", entityId: null, message: "Open-Dot de pesquisa não registra heartbeat nas últimas 24 horas.", action: "Verificar o Dot de pesquisa e sua rotina sem habilitar egress." });
    }
    if (!facts.lastEmailAt || facts.lastEmailAt < heartbeatCutoff) {
      findings.push({ code: "EMAIL_HEARTBEAT_STALE", severity: "ATTENTION", count: 1, entityType: "OpenDotClient", entityId: null, message: "Open-Dot de e-mail não registra heartbeat nas últimas 24 horas.", action: "Verificar o Dot de e-mail e o provider mantendo o egress bloqueado." });
    }
    return findings.sort((left, right) => left.code.localeCompare(right.code));
  }

  async function reconcileWorkspace(workspaceId: string, workerId: string, force = false) {
    const now = options.now();
    const dueBefore = new Date(now.getTime() - DAY_MS);
    return options.database.$transaction(async (database) => {
      await database.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospecting-reconciliation:${workspaceId}`}, 0))`;
      const existing = await database.prospectingReconciliationState.findUnique({ where: { workspaceId } });
      if (!force && existing && existing.lastRunAt >= dueBefore) return { status: "IDLE" as const };
      const actor = await database.actor.findFirst({ where: { workspaceId, type: "SYSTEM", key: "system" }, select: { id: true } });
      if (!actor) throw new ApplicationError("Ator de sistema ausente para reconciliação.", { code: "PROSPECTING_SYSTEM_ACTOR_MISSING", statusCode: 409 });
      const findings = await collect(database, workspaceId, now);
      const health = findings.some((item) => item.severity === "CRITICAL") ? "CRITICAL" : findings.length > 0 ? "ATTENTION" : "HEALTHY";
      const hash = findingsHash(findings);
      const state = await database.prospectingReconciliationState.upsert({
        where: { workspaceId },
        create: { workspaceId, status: health, findings: findings as Prisma.InputJsonValue, findingsHash: hash, lastRunAt: now, createdByActorId: actor.id, updatedByActorId: actor.id },
        update: { status: health, findings: findings as Prisma.InputJsonValue, findingsHash: hash, lastRunAt: now, updatedByActorId: actor.id },
      });
      if (!existing || existing.findingsHash !== hash || existing.status !== health) {
        await database.auditLog.create({
          data: {
            workspaceId,
            actorId: actor.id,
            action: "prospecting.reconciliation.changed",
            entityType: "ProspectingReconciliationState",
            entityId: state.id,
            origin: "SYSTEM",
            requestId: workerId,
            occurredAt: now,
            changes: { previousStatus: existing?.status ?? null, status: health, findingCodes: findings.map((item) => item.code), findingCounts: Object.fromEntries(findings.map((item) => [item.code, item.count])), externalEgress: false },
          },
        });
      }
      return { status: "RECONCILED" as const, workspaceId, health, findings: findings.length };
    });
  }

  async function processNext(workerId: string) {
    const repair = await repairMissingInstagramContacts(workerId);
    if (repair.repaired > 0) return repair;
    const dueBefore = new Date(options.now().getTime() - DAY_MS);
    const [workspace] = await options.database.$queryRaw<DueWorkspace[]>(Prisma.sql`
      SELECT settings."workspaceId"
      FROM "prospecting_settings" settings
      LEFT JOIN "prospecting_reconciliation_states" state ON state."workspaceId" = settings."workspaceId"
      WHERE (state."lastRunAt" IS NULL OR state."lastRunAt" < ${dueBefore})
        AND EXISTS (SELECT 1 FROM "actors" actor
          WHERE actor."workspaceId" = settings."workspaceId" AND actor."type"::text = 'SYSTEM' AND actor."key" = 'system')
      ORDER BY state."lastRunAt" ASC NULLS FIRST, settings."workspaceId" ASC
      LIMIT 1
    `);
    if (!workspace) return { status: "IDLE" as const };
    return reconcileWorkspace(workspace.workspaceId, workerId);
  }

  return Object.freeze({ processNext, reconcileWorkspace, repairMissingInstagramContacts });
}

let singleton: ReturnType<typeof createProspectingReconciliationService> | undefined;
export function getProspectingReconciliationService() {
  singleton ??= createProspectingReconciliationService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
