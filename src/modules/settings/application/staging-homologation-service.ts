import { createHash, randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { hashPassword } from "@/modules/auth/domain/password";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import {
  leadStageCodes,
  leadStageLabels,
} from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import { regularDestinationCodes } from "@/modules/pipelines/domain/lead-stage-transition-policy";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { AccessRoleKeys, PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { loadEnvironmentContract } from "@/shared/core/config/environment-contract";
import { ApplicationError, ConfigurationError } from "@/shared/core/errors/application-error";

const CONFIRMATION = "CREATE_STAGING_SYNTHETIC_DATASET";
const WORKSPACE_SLUG = "politizai-staging";
const LEAD_IDEMPOTENCY_KEY = "prod06:staging-homologation:lead:v1";
const LEAD_PHONE = "+5511900000606";
const CLOSER_PASSWORD_MIN_LENGTH = 16;

const roleDefinitions = [
  {
    key: AccessRoleKeys.SDR,
    name: "SDR de homologação",
    grants: [
      [PermissionKeys.LEADS_READ, "OWN"],
      [PermissionKeys.LEADS_WRITE, "OWN"],
      [PermissionKeys.TASKS_READ, "OWN"],
      [PermissionKeys.TASKS_WRITE, "OWN"],
    ],
  },
  {
    key: AccessRoleKeys.CLOSER,
    name: "Closer de homologação",
    grants: [
      [PermissionKeys.MEETINGS_READ, "OWN"],
      [PermissionKeys.MEETINGS_WRITE, "OWN"],
      [PermissionKeys.OPPORTUNITIES_READ, "OWN"],
      [PermissionKeys.OPPORTUNITIES_WRITE, "OWN"],
      [PermissionKeys.CONTRACTS_READ, "OWN"],
      [PermissionKeys.CONTRACTS_CREATE, "OWN"],
      [PermissionKeys.CONTRACTS_DRAFT_WRITE, "OWN"],
      [PermissionKeys.CONTRACTS_ISSUE, "OWN"],
      [PermissionKeys.CONTRACTS_SEND_SIMULATE, "OWN"],
      [PermissionKeys.CONTRACTS_ACCEPT_RECORD, "OWN"],
      [PermissionKeys.CONTRACTS_REJECT, "OWN"],
      [PermissionKeys.CONTRACTS_VERSION_CREATE, "OWN"],
      [PermissionKeys.REVENUE_READ, "OWN"],
      [PermissionKeys.REVENUE_MANAGE, "OWN"],
      [PermissionKeys.REVENUE_EVENTS_RECORD, "OWN"],
      [PermissionKeys.PAYMENTS_READ, "OWN"],
      [PermissionKeys.PAYMENTS_MANAGE, "OWN"],
      [PermissionKeys.ONBOARDING_READ, "OWN"],
      [PermissionKeys.ONBOARDING_ACCEPT, "OWN"],
      [PermissionKeys.ONBOARDING_EXECUTE, "OWN"],
      [PermissionKeys.CUSTOMER_SUCCESS_READ, "OWN"],
      [PermissionKeys.CUSTOMER_SUCCESS_PLAN_MANAGE, "OWN"],
      [PermissionKeys.CUSTOMER_SUCCESS_EVIDENCE_RECORD, "OWN"],
      [PermissionKeys.CUSTOMER_SUCCESS_HEALTH_EVALUATE, "OWN"],
      [PermissionKeys.CUSTOMER_SERVICE_READ, "OWN"],
      [PermissionKeys.CUSTOMER_SERVICE_CREATE, "OWN"],
      [PermissionKeys.CUSTOMER_SERVICE_RESPOND, "OWN"],
      [PermissionKeys.CUSTOMER_SERVICE_RESOLVE, "OWN"],
      [PermissionKeys.CUSTOMER_SERVICE_REOPEN, "OWN"],
      [PermissionKeys.CUSTOMER_SERVICE_SATISFACTION_READ, "OWN"],
      [PermissionKeys.FARMER_READ, "OWN"],
      [PermissionKeys.FARMER_RENEWALS_WRITE, "OWN"],
      [PermissionKeys.FARMER_RENEWALS_CONFIRM, "OWN"],
      [PermissionKeys.FARMER_EXPANSION_WRITE, "OWN"],
      [PermissionKeys.FARMER_EXPANSION_CONFIRM, "OWN"],
      [PermissionKeys.FARMER_REVENUE_CONFIRM, "OWN"],
      [PermissionKeys.CONTACTS_READ, "OWN"],
      [PermissionKeys.ACCOUNTS_READ, "OWN"],
      [PermissionKeys.ACCOUNTS_LINK, "OWN"],
      [PermissionKeys.ACCOUNT_ROLES_MANAGE, "OWN"],
      [PermissionKeys.BUYING_COMMITTEE_MANAGE, "OWN"],
      [PermissionKeys.LIFECYCLE_READ, "OWN"],
      [PermissionKeys.LIFECYCLE_TRANSITION, "OWN"],
      [PermissionKeys.OWNERSHIP_READ, "OWN"],
      [PermissionKeys.OWNERSHIP_TRANSFER, "OWN"],
      [PermissionKeys.OWNERSHIP_ACCEPT, "OWN"],
      [PermissionKeys.PRIVACY_STATUS_READ, "OWN"],
      [PermissionKeys.PRIVACY_CONSENT_RECORD, "OWN"],
      [PermissionKeys.INBOX_READ, "OWN"],
      [PermissionKeys.MESSAGES_COMPOSE, "OWN"],
      [PermissionKeys.MESSAGES_SEND, "OWN"],
      [PermissionKeys.MESSAGES_VIEW_SENSITIVE, "OWN"],
      [PermissionKeys.TELEPHONY_READ, "OWN"],
      [PermissionKeys.TELEPHONY_START, "OWN"],
      [PermissionKeys.TELEPHONY_CANCEL, "OWN"],
      [PermissionKeys.TELEPHONY_DISPOSITION, "OWN"],
      [PermissionKeys.CALENDAR_READ, "OWN"],
      [PermissionKeys.CALENDAR_SYNC, "OWN"],
      [PermissionKeys.METRICS_READ, "OWN"],
      [PermissionKeys.DATA_QUALITY_READ, "OWN"],
      [PermissionKeys.DATA_QUALITY_RESOLVE, "OWN"],
      [PermissionKeys.GOALS_READ, "OWN"],
      [PermissionKeys.FORECAST_READ, "OWN"],
      [PermissionKeys.FORECAST_SUBMIT, "OWN"],
      [PermissionKeys.MARKETING_JOURNEY_READ, "OWN"],
      [PermissionKeys.MARKETING_MEDIA_READ, "OWN"],
      [PermissionKeys.GEOGRAPHY_READ, "OWN"],
      [PermissionKeys.AI_USE, "OWN"],
    ],
  },
  {
    key: AccessRoleKeys.VIEWER,
    name: "Visualizador de homologação",
    grants: [
      [PermissionKeys.LEADS_READ, "WORKSPACE"],
      [PermissionKeys.TASKS_READ, "WORKSPACE"],
    ],
  },
] as const;

const syntheticUsers = [
  {
    key: "sdr-prod06",
    email: "sdr-prod06@synthetic.politizai.local",
    displayName: "SDR sintético PROD-06",
    roleKey: AccessRoleKeys.SDR,
  },
  {
    key: "viewer-prod06",
    email: "viewer-prod06@synthetic.politizai.local",
    displayName: "Visualizador sintético PROD-06",
    roleKey: AccessRoleKeys.VIEWER,
  },
  {
    key: "closer-prod10",
    email: "closer-prod10@synthetic.politizai.local",
    displayName: "Closer sintético PROD-10",
    roleKey: AccessRoleKeys.CLOSER,
  },
] as const;

type StagingHomologationEnvironment = Readonly<{
  workspaceSlug: typeof WORKSPACE_SLUG;
  closerPassword: string;
}>;

type SyntheticIdentity = Readonly<{
  memberId: string;
  userId: string;
  actorId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  displayName: string;
}>;

const stagingLeadStageDefinitions = leadStageCodes.map((code, position) => ({
  code,
  name: leadStageLabels[code],
  position,
  type: code === "QUALIFIED" ? "WON" as const : code === "DISQUALIFIED" ? "LOST" as const : "OPEN" as const,
}));

export async function ensureStagingLeadPipeline(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  systemActorId: string,
) {
  let pipeline = await transaction.pipeline.findFirst({
    where: { workspaceId, entityType: "LEAD", isDefault: true, deletedAt: null },
  });
  pipeline ??= await transaction.pipeline.create({
    data: {
      workspaceId,
      name: "Pré-vendas sintético PROD-06",
      entityType: "LEAD",
      isDefault: true,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });

  const initialStages = await transaction.pipelineStage.findMany({
    where: { workspaceId, pipelineId: pipeline.id, deletedAt: null },
    select: { id: true, leadStageCode: true },
  });
  const stageByCode = new Map(initialStages.flatMap((stage) => (
    stage.leadStageCode ? [[stage.leadStageCode, stage.id] as const] : []
  )));
  const createdStageCodes: string[] = [];
  for (const definition of stagingLeadStageDefinitions) {
    if (stageByCode.has(definition.code)) continue;
    const stage = await transaction.pipelineStage.create({
      data: {
        workspaceId,
        pipelineId: pipeline.id,
        name: definition.name,
        position: definition.position,
        type: definition.type,
        leadStageCode: definition.code,
        createdByActorId: systemActorId,
        updatedByActorId: systemActorId,
      },
    });
    stageByCode.set(definition.code, stage.id);
    createdStageCodes.push(definition.code);
  }

  let createdTransitions = 0;
  let reactivatedTransitions = 0;
  for (const fromCode of leadStageCodes) {
    for (const toCode of regularDestinationCodes(fromCode)) {
      const fromStageId = stageByCode.get(fromCode);
      const toStageId = stageByCode.get(toCode);
      if (!fromStageId || !toStageId) {
        throw new Error(`Etapa sintética ausente para ${fromCode} -> ${toCode}.`);
      }
      const existing = await transaction.pipelineStageTransition.findFirst({
        where: { workspaceId, pipelineId: pipeline.id, fromStageId, toStageId },
      });
      if (!existing) {
        await transaction.pipelineStageTransition.create({
          data: {
            workspaceId,
            pipelineId: pipeline.id,
            fromStageId,
            toStageId,
            createdByActorId: systemActorId,
            updatedByActorId: systemActorId,
          },
        });
        createdTransitions += 1;
      } else if (!existing.active) {
        await transaction.pipelineStageTransition.update({
          where: { id: existing.id },
          data: { active: true, updatedByActorId: systemActorId },
        });
        reactivatedTransitions += 1;
      }
    }
  }

  let disqualificationReason = await transaction.disqualificationReason.findFirst({
    where: { workspaceId, key: "synthetic-prod10-pipeline", deletedAt: null },
  });
  const createdDisqualificationReason = !disqualificationReason;
  disqualificationReason ??= await transaction.disqualificationReason.create({
    data: {
      workspaceId,
      key: "synthetic-prod10-pipeline",
      name: "Fora do perfil — homologação sintética",
      position: 0,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });

  const changed = createdStageCodes.length > 0 || createdTransitions > 0 || reactivatedTransitions > 0 || createdDisqualificationReason;
  if (changed) {
    await transaction.auditLog.create({
      data: {
        workspaceId,
        actorId: systemActorId,
        action: "prod10.pipeline_configuration.repaired",
        entityType: "Pipeline",
        entityId: pipeline.id,
        origin: "SYSTEM",
        reason: "Completar configuração sintética necessária à homologação do Pipeline.",
        metadata: {
          synthetic: true,
          externalEgress: false,
          createdStageCodes,
          createdTransitions,
          reactivatedTransitions,
          createdDisqualificationReason,
        },
      },
    });
  }

  return Object.freeze({
    pipelineId: pipeline.id,
    stageCount: stageByCode.size,
    createdStageCodes: Object.freeze([...createdStageCodes]),
    createdTransitions,
    reactivatedTransitions,
    disqualificationReasonId: disqualificationReason.id,
    changed,
  });
}

export type StagingHomologationResult = Readonly<{
  workspaceId: string;
  leadId: string;
  leadFingerprint: string;
  leadCount: number;
  userCount: number;
  teamCount: number;
  migrationCount: number;
  idempotentReplay: boolean;
  rbac: Readonly<{
    administratorAllowed: boolean;
    sdrOwnAllowed: boolean;
    viewerReadAllowed: boolean;
    viewerWriteDenied: boolean;
    closerOwnAllowed: boolean;
    closerAdministrationDenied: boolean;
    crossWorkspaceDenied: boolean;
  }>;
  invariants: Readonly<{
    explicitOperationalOwner: boolean;
    nextActionPresent: boolean;
    immediateTaskDueAtReceivedAt: boolean;
    slaTimestampsConsistent: boolean;
    timelinePresent: boolean;
    auditPresent: boolean;
  }>;
}>;

export function parseStagingHomologationEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): StagingHomologationEnvironment {
  const contract = loadEnvironmentContract(source);
  const invalid: string[] = [];
  if (contract.APP_ENV !== "staging") invalid.push("APP_ENV");
  if (contract.NODE_ENV !== "production") invalid.push("NODE_ENV");
  if (contract.PROCESS_ROLE !== "migration") invalid.push("PROCESS_ROLE");
  if (contract.DATABASE_EXPECTED_NAME !== "politizai_staging") invalid.push("DATABASE_EXPECTED_NAME");
  if (contract.DATABASE_EXPECTED_SCHEMA !== "public") invalid.push("DATABASE_EXPECTED_SCHEMA");
  if (!contract.databaseUrl.hostname.endsWith(".neon.tech")) invalid.push("DATABASE_URL");
  if (!contract.directUrl?.hostname.endsWith(".neon.tech")) invalid.push("DIRECT_URL");
  if (source.STAGING_HOMOLOGATION_CONFIRMATION !== CONFIRMATION) {
    invalid.push("STAGING_HOMOLOGATION_CONFIRMATION");
  }
  if (source.STAGING_HOMOLOGATION_WORKSPACE_SLUG !== WORKSPACE_SLUG) {
    invalid.push("STAGING_HOMOLOGATION_WORKSPACE_SLUG");
  }
  const closerPassword = source.STAGING_HOMOLOGATION_CLOSER_PASSWORD;
  if (!closerPassword || closerPassword.length < CLOSER_PASSWORD_MIN_LENGTH) {
    invalid.push("STAGING_HOMOLOGATION_CLOSER_PASSWORD");
  }
  if (invalid.length > 0) throw new ConfigurationError(invalid);
  return { workspaceSlug: WORKSPACE_SLUG, closerPassword: closerPassword! };
}

function contextFor(
  workspaceId: string,
  workspaceSlug: string,
  identity: SyntheticIdentity,
): AuthenticatedContext {
  return {
    workspaceId,
    workspaceSlug,
    sessionId: `homologation:${identity.memberId}`,
    userId: identity.userId,
    memberId: identity.memberId,
    actorId: identity.actorId,
    roleId: identity.roleId,
    roleKey: identity.roleKey,
    roleName: identity.roleName,
    displayName: identity.displayName,
  };
}

async function ensureRole(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  systemActorId: string,
  definition: (typeof roleDefinitions)[number],
) {
  let role = await tx.role.findFirst({
    where: { workspaceId, key: definition.key, deletedAt: null },
  });
  role ??= await tx.role.create({
    data: {
      workspaceId,
      key: definition.key,
      name: definition.name,
      description: "Papel mínimo e sintético de homologação da PROD-06.",
      isSystem: true,
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  for (const [permissionKey, scope] of definition.grants) {
    const permission = await tx.permission.findUniqueOrThrow({ where: { key: permissionKey } });
    const current = await tx.rolePermission.findFirst({
      where: { workspaceId, roleId: role.id, permissionId: permission.id },
    });
    if (!current) {
      await tx.rolePermission.create({
        data: {
          workspaceId,
          roleId: role.id,
          permissionId: permission.id,
          scope,
          createdByActorId: systemActorId,
        },
      });
    }
  }
  return role;
}

async function ensureSyntheticIdentity(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  systemActorId: string,
  roles: ReadonlyMap<string, Readonly<{ id: string; key: string; name: string }>>,
  definition: (typeof syntheticUsers)[number],
): Promise<SyntheticIdentity> {
  let user = await tx.user.findUnique({ where: { normalizedEmail: definition.email } });
  user ??= await tx.user.create({
    data: {
      email: definition.email,
      normalizedEmail: definition.email,
      displayName: definition.displayName,
    },
  });
  const role = roles.get(definition.roleKey);
  if (!role) throw new Error(`Papel sintético ausente: ${definition.roleKey}`);
  let member = await tx.workspaceMember.findFirst({ where: { workspaceId, userId: user.id } });
  member ??= await tx.workspaceMember.create({
    data: {
      workspaceId,
      userId: user.id,
      roleId: role.id,
      status: "ACTIVE",
      joinedAt: new Date(),
      createdByActorId: systemActorId,
      updatedByActorId: systemActorId,
    },
  });
  let actor = await tx.actor.findFirst({
    where: { workspaceId, userId: user.id, type: "HUMAN" },
  });
  actor ??= await tx.actor.create({
    data: {
      workspaceId,
      userId: user.id,
      type: "HUMAN",
      key: `user:${user.id}`,
      displayName: definition.displayName,
    },
  });
  return {
    memberId: member.id,
    userId: user.id,
    actorId: actor.id,
    roleId: role.id,
    roleKey: role.key,
    roleName: role.name,
    displayName: user.displayName,
  };
}

export function createStagingHomologationService(database: PrismaClient) {
  return Object.freeze({
    async run(environment: StagingHomologationEnvironment): Promise<StagingHomologationResult> {
      const prepared = await database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('politizai_prod06_staging_homologation_v1'))`;
        const workspace = await tx.workspace.findUniqueOrThrow({
          where: { slug: environment.workspaceSlug },
        });
        const systemActor = await tx.actor.findFirstOrThrow({
          where: { workspaceId: workspace.id, type: "SYSTEM", key: "system", userId: null },
        });
        let automationActor = await tx.actor.findFirst({
          where: {
            workspaceId: workspace.id,
            type: "AUTOMATION",
            key: "automation:staging",
            userId: null,
          },
        });
        automationActor ??= await tx.actor.create({
          data: {
            workspaceId: workspace.id,
            type: "AUTOMATION",
            key: "automation:staging",
            displayName: "Automação de staging",
          },
        });
        const automationActorAudit = await tx.auditLog.findFirst({
          where: {
            workspaceId: workspace.id,
            action: "prod07.staging_automation_actor.prepared",
            entityType: "Actor",
            entityId: automationActor.id,
          },
        });
        if (!automationActorAudit) {
          await tx.auditLog.create({
            data: {
              workspaceId: workspace.id,
              actorId: systemActor.id,
              action: "prod07.staging_automation_actor.prepared",
              entityType: "Actor",
              entityId: automationActor.id,
              origin: "SYSTEM",
              reason: "Ator sintético exigido pelo fluxo web de entrada de leads em staging.",
              metadata: { environment: "staging", task: "PROD-07", externalEgress: false },
            },
          });
        }
        const administrator = await tx.workspaceMember.findFirstOrThrow({
          where: {
            workspaceId: workspace.id,
            status: "ACTIVE",
            deletedAt: null,
            role: { key: AccessRoleKeys.ADMINISTRATOR, deletedAt: null },
            user: { status: "ACTIVE", deletedAt: null },
          },
          include: { role: true, user: true },
        });
        const administratorActor = await tx.actor.findFirstOrThrow({
          where: { workspaceId: workspace.id, userId: administrator.userId, type: "HUMAN" },
        });

        const roles = new Map<string, Readonly<{ id: string; key: string; name: string }>>();
        for (const definition of roleDefinitions) {
          const role = await ensureRole(tx, workspace.id, systemActor.id, definition);
          roles.set(definition.key, role);
        }
        const identities = new Map<string, SyntheticIdentity>();
        for (const definition of syntheticUsers) {
          identities.set(
            definition.key,
            await ensureSyntheticIdentity(tx, workspace.id, systemActor.id, roles, definition),
          );
        }
        const sdr = identities.get("sdr-prod06");
        const viewer = identities.get("viewer-prod06");
        const closer = identities.get("closer-prod10");
        if (!sdr || !viewer || !closer) throw new Error("Identidades sintéticas incompletas.");

        const closerCredential = await tx.localCredential.findUnique({
          where: { userId: closer.userId },
        });
        if (!closerCredential) {
          await tx.localCredential.create({
            data: {
              userId: closer.userId,
              passwordHash: await hashPassword(environment.closerPassword),
              passwordChangedAt: new Date(),
            },
          });
        }
        const closerAudit = await tx.auditLog.findFirst({
          where: {
            workspaceId: workspace.id,
            action: "prod10.staging_closer.prepared",
            entityType: "WorkspaceMember",
            entityId: closer.memberId,
          },
        });
        if (!closerAudit) {
          await tx.auditLog.create({
            data: {
              workspaceId: workspace.id,
              actorId: systemActor.id,
              action: "prod10.staging_closer.prepared",
              entityType: "WorkspaceMember",
              entityId: closer.memberId,
              origin: "SYSTEM",
              reason: "Identidade sintética interativa de closer preparada para homologação cross-role.",
              metadata: {
                dataset: "PROD-10",
                externalEgress: false,
                credentialCreated: !closerCredential,
              },
            },
          });
        }

        let team = await tx.team.findFirst({
          where: { workspaceId: workspace.id, name: "Pré-vendas sintético PROD-06", deletedAt: null },
        });
        team ??= await tx.team.create({
          data: {
            workspaceId: workspace.id,
            name: "Pré-vendas sintético PROD-06",
            description: "Equipe exclusiva do dataset sintético de homologação.",
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });
        let teamMember = await tx.teamMember.findFirst({
          where: { workspaceId: workspace.id, teamId: team.id, workspaceMemberId: sdr.memberId },
        });
        teamMember ??= await tx.teamMember.create({
          data: {
            workspaceId: workspace.id,
            teamId: team.id,
            workspaceMemberId: sdr.memberId,
            function: "SDR",
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });

        let queue = await tx.queue.findFirst({
          where: { workspaceId: workspace.id, isGeneral: true, deletedAt: null },
        });
        queue ??= await tx.queue.create({
          data: {
            workspaceId: workspace.id,
            teamId: team.id,
            key: "general-prod06",
            name: "Fila Geral sintética PROD-06",
            isGeneral: true,
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });

        let source = await tx.leadSource.findFirst({
          where: { workspaceId: workspace.id, key: "synthetic-prod06", deletedAt: null },
        });
        source ??= await tx.leadSource.create({
          data: {
            workspaceId: workspace.id,
            key: "synthetic-prod06",
            name: "Homologação sintética PROD-06",
            type: "OTHER",
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });

        await ensureStagingLeadPipeline(tx, workspace.id, systemActor.id);

        const bands = [
          { code: "P1", name: "P1 — atendimento imediato", position: 0, scoreMin: 70, scoreMax: 100, priority: "URGENT", key: "prod06-p1" },
          { code: "P2", name: "P2 — atendimento prioritário", position: 1, scoreMin: 40, scoreMax: 69, priority: "HIGH", key: "prod06-p2" },
          { code: "P3", name: "P3 — atendimento padrão", position: 2, scoreMin: 0, scoreMax: 39, priority: "MEDIUM", key: "prod06-p3" },
        ] as const;
        for (const definition of bands) {
          let policy = await tx.slaPolicy.findFirst({
            where: { workspaceId: workspace.id, key: definition.key, version: 1, deletedAt: null },
          });
          policy ??= await tx.slaPolicy.create({
            data: {
              workspaceId: workspace.id,
              key: definition.key,
              name: "SLA imediato — 0 minutos",
              firstResponseMinutes: 0,
              warningMinutesBeforeDue: 0,
              healthyMaxSeconds: 60,
              attentionMaxSeconds: 180,
              version: 1,
              createdByActorId: systemActor.id,
              updatedByActorId: systemActor.id,
            },
          });
          const existingBand = await tx.leadPriorityBand.findFirst({
            where: { workspaceId: workspace.id, code: definition.code, deletedAt: null },
          });
          if (!existingBand) {
            await tx.leadPriorityBand.create({
              data: {
                workspaceId: workspace.id,
                slaPolicyId: policy.id,
                code: definition.code,
                name: definition.name,
                position: definition.position,
                scoreMin: definition.scoreMin,
                scoreMax: definition.scoreMax,
                leadPriority: definition.priority,
                createdByActorId: systemActor.id,
                updatedByActorId: systemActor.id,
              },
            });
          }
        }

        const alreadyAudited = await tx.auditLog.findFirst({
          where: {
            workspaceId: workspace.id,
            action: "prod06.staging_dataset.prepared",
            entityType: "Workspace",
            entityId: workspace.id,
          },
        });
        if (!alreadyAudited) {
          await tx.auditLog.create({
            data: {
              workspaceId: workspace.id,
              actorId: systemActor.id,
              action: "prod06.staging_dataset.prepared",
              entityType: "Workspace",
              entityId: workspace.id,
              origin: "SYSTEM",
              reason: "Configuração mínima e identidades sintéticas sem credenciais interativas.",
              metadata: { dataset: "PROD-06", version: 1, externalEgress: false },
            },
          });
        }

        return {
          workspace,
          systemActor,
          queue,
          team,
          source,
          sdr,
          viewer,
          closer,
          administrator: {
            memberId: administrator.id,
            userId: administrator.userId,
            actorId: administratorActor.id,
            roleId: administrator.roleId,
            roleKey: administrator.role.key,
            roleName: administrator.role.name,
            displayName: administrator.user.displayName,
          } satisfies SyntheticIdentity,
        };
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });

      const serviceActor: ServiceActorContext = {
        workspaceId: prepared.workspace.id,
        actorId: prepared.systemActor.id,
        actorType: "SYSTEM",
        actorKey: prepared.systemActor.key,
      };
      const intake = createLeadIntakeService({
        database,
        authorization: createAuthorizationService({ database }),
        now: () => new Date(),
      });
      const payload = {
        channel: "SIMULATOR" as const,
        idempotencyKey: LEAD_IDEMPOTENCY_KEY,
        fullName: "Lead sintético PROD-06",
        phone: LEAD_PHONE,
        email: "lead-prod06@synthetic.politizai.local",
        jobTitle: "Pessoa de homologação",
        organizationName: "Organização sintética PROD-06",
        city: "São Paulo",
        stateCode: "SP",
        interestSummary: "Validar de forma sintética a jornada mínima de staging.",
        sourceKey: prepared.source.key,
        rawPayload: { dataset: "PROD-06", synthetic: true, externalEgress: false },
        priorityBandCode: "P1" as const,
      };
      const first = await intake.intake(payload, serviceActor);
      if (first.outcome === "REJECTED") {
        throw new ApplicationError("O dataset sintético foi rejeitado pelo domínio.", {
          code: "STAGING_HOMOLOGATION_REJECTED",
          statusCode: 500,
          expose: false,
        });
      }
      const replay = await intake.intake(payload, serviceActor);
      if (replay.outcome === "REJECTED" || !replay.idempotentReplay || replay.leadId !== first.leadId) {
        throw new ApplicationError("A repetição idempotente do dataset falhou.", {
          code: "STAGING_HOMOLOGATION_IDEMPOTENCY_FAILED",
          statusCode: 500,
          expose: false,
        });
      }

      const authorization = createAuthorizationService({ database });
      const admin = contextFor(prepared.workspace.id, prepared.workspace.slug, prepared.administrator);
      const sdr = contextFor(prepared.workspace.id, prepared.workspace.slug, prepared.sdr);
      const viewer = contextFor(prepared.workspace.id, prepared.workspace.slug, prepared.viewer);
      const closer = contextFor(prepared.workspace.id, prepared.workspace.slug, prepared.closer);
      const lead = await database.lead.findUniqueOrThrow({
        where: { id: first.leadId },
        include: {
          nextActionTask: true,
          slaCycles: { where: { submissionId: first.submissionId }, take: 1 },
        },
      });
      const resource = {
        workspaceId: prepared.workspace.id,
        resourceType: "Lead",
        resourceId: first.leadId,
        ownerMemberId: lead.ownerMemberId,
        teamId: prepared.team.id,
        queueId: lead.queueId,
      };
      const administratorDecision = await authorization.authorize(admin, PermissionKeys.WORKSPACE_MANAGE, {
          workspaceId: prepared.workspace.id,
          resourceType: "Workspace",
        });
      const sdrDecision = await authorization.authorize(sdr, PermissionKeys.LEADS_WRITE, resource);
      const viewerReadDecision = await authorization.authorize(viewer, PermissionKeys.LEADS_READ, resource);
      const viewerWriteDecision = await authorization.authorize(viewer, PermissionKeys.LEADS_WRITE, resource);
      const closerReadDecision = await authorization.authorize(closer, PermissionKeys.OPPORTUNITIES_READ, {
        workspaceId: prepared.workspace.id,
        resourceType: "Opportunity",
        ownerMemberId: closer.memberId,
      });
      const closerAdministrationDecision = await authorization.authorize(
        closer,
        PermissionKeys.WORKSPACE_MEMBERS_MANAGE,
        { workspaceId: prepared.workspace.id, resourceType: "Workspace" },
      );
      const crossWorkspaceDecision = await authorization.authorize(admin, PermissionKeys.WORKSPACE_MANAGE, {
          workspaceId: randomUUID(),
          resourceType: "Workspace",
        });

      const sla = lead.slaCycles[0];
      const timelineCount = await database.activity.count({ where: { workspaceId: prepared.workspace.id, leadId: lead.id } });
      const auditCount = await database.auditLog.count({ where: { workspaceId: prepared.workspace.id, entityType: "Lead", entityId: lead.id } });
      const leadCount = await database.lead.count({ where: { workspaceId: prepared.workspace.id } });
      const userCount = await database.workspaceMember.count({ where: { workspaceId: prepared.workspace.id, deletedAt: null } });
      const teamCount = await database.team.count({ where: { workspaceId: prepared.workspace.id, deletedAt: null } });
      const migrationCount = await database.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      const idFingerprint = createHash("sha256")
        .update([lead.id, first.submissionId, first.slaCycleId, first.taskId].sort().join(":"))
        .digest("hex");

      return {
        workspaceId: prepared.workspace.id,
        leadId: lead.id,
        leadFingerprint: idFingerprint,
        leadCount,
        userCount,
        teamCount,
        migrationCount: Number(migrationCount[0]?.count ?? 0n),
        idempotentReplay: replay.idempotentReplay,
        rbac: {
          administratorAllowed: administratorDecision.allowed,
          sdrOwnAllowed: sdrDecision.allowed,
          viewerReadAllowed: viewerReadDecision.allowed,
          viewerWriteDenied: !viewerWriteDecision.allowed && viewerWriteDecision.reason === "MISSING_PERMISSION",
          closerOwnAllowed: closerReadDecision.allowed,
          closerAdministrationDenied:
            !closerAdministrationDecision.allowed && closerAdministrationDecision.reason === "MISSING_PERMISSION",
          crossWorkspaceDenied: !crossWorkspaceDecision.allowed && crossWorkspaceDecision.reason === "WORKSPACE_MISMATCH",
        },
        invariants: {
          explicitOperationalOwner: Boolean(lead.ownerMemberId || lead.queueId),
          nextActionPresent: Boolean(lead.nextActionTaskId && lead.nextActionAt && lead.nextActionDescription),
          immediateTaskDueAtReceivedAt: Boolean(lead.nextActionTask && sla && lead.nextActionTask.dueAt.getTime() === sla.receivedAt.getTime()),
          slaTimestampsConsistent: Boolean(sla && sla.assignedAt.getTime() === sla.receivedAt.getTime() && sla.automaticAcknowledgedAt.getTime() === sla.receivedAt.getTime()),
          timelinePresent: timelineCount > 0,
          auditPresent: auditCount > 0,
        },
      };
    },
  });
}
