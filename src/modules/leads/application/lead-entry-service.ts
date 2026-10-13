import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { toLeadIntakeInput } from "@/modules/leads/application/lead-entry-mapper";
import {
  getLeadIntakeService,
  type LeadIntakeResult,
} from "@/modules/leads/application/lead-intake-service";
import {
  leadEntryFieldsSchema,
  manualLeadEntryRequestSchema,
  simulatorRequestSchema,
} from "@/modules/leads/domain/lead-entry-contracts";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

type AuthorizationPort = Readonly<{
  authorize: ReturnType<typeof getAuthorizationService>["authorize"];
  assertAuthorized: ReturnType<typeof getAuthorizationService>["assertAuthorized"];
}>;

type IntakePort = Readonly<{
  intake: (
    payload: unknown,
    context: AuthenticatedContext,
  ) => Promise<LeadIntakeResult>;
}>;

type LeadEntryServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  intake: IntakePort;
}>;

export type LeadEntryOptions = Awaited<
  ReturnType<ReturnType<typeof createLeadEntryService>["getOptions"]>
>;

function issuesFromZod(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "payload",
    message: issue.message,
  }));
}

function simulatedPhone(seed: string, index: number): string {
  const hash = createHash("sha256").update(`${seed}:${index}`).digest("hex");
  const suffix = (BigInt(`0x${hash.slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

export function createLeadEntryService(options: LeadEntryServiceOptions) {
  async function authorize(context: AuthenticatedContext) {
    const queue = await options.database.queue.findFirst({
      where: {
        workspaceId: context.workspaceId,
        isGeneral: true,
        deletedAt: null,
      },
      select: { id: true, teamId: true },
    });
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.LEADS_WRITE,
      {
        workspaceId: context.workspaceId,
        resourceType: "LeadEntry",
        ...(queue
          ? { queueId: queue.id, teamId: queue.teamId }
          : { memberId: context.memberId }),
      },
    );
    return queue;
  }

  async function getOptions(context: AuthenticatedContext) {
    await authorize(context);
    const assignmentDecision = await options.authorization.authorize(
      context,
      PermissionKeys.LEADS_ASSIGN,
      {
        workspaceId: context.workspaceId,
        resourceType: "WorkspaceMember",
        resourceId: context.memberId,
        memberId: context.memberId,
      },
    );
    const teamIds = assignmentDecision.allowed && assignmentDecision.scope === "TEAM"
      ? (await options.database.teamMember.findMany({
          where: {
            workspaceId: context.workspaceId,
            workspaceMemberId: context.memberId,
            deletedAt: null,
            team: { deletedAt: null },
          },
          select: { teamId: true },
        })).map(({ teamId }) => teamId)
      : undefined;
    const sellerWhere = assignmentDecision.allowed
      ? commercialMemberWhere({
          workspaceId: context.workspaceId,
          functions: ["SDR", "CLOSER"],
          requireLeadAvailability: true,
          ...(assignmentDecision.scope === "OWN"
            ? { memberId: context.memberId }
            : assignmentDecision.scope === "TEAM"
              ? { teamIds: teamIds ?? [] }
              : {}),
        })
      : null;
    const [workspace, sources, campaigns, priorityBands, pipelines, sellers] = await Promise.all([
      options.database.workspace.findFirstOrThrow({
        where: { id: context.workspaceId, deletedAt: null },
        select: { timeZone: true },
      }),
      options.database.leadSource.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        orderBy: { name: "asc" },
        select: { key: true, name: true, type: true },
      }),
      options.database.acquisitionCampaign.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        orderBy: { name: "asc" },
        select: {
          externalRef: true,
          name: true,
          creatives: {
            where: { deletedAt: null },
            orderBy: { name: "asc" },
            select: { externalRef: true, name: true },
          },
        },
      }),
      options.database.leadPriorityBand.findMany({
        where: {
          workspaceId: context.workspaceId,
          active: true,
          deletedAt: null,
          slaPolicy: { active: true, deletedAt: null },
        },
        orderBy: { position: "asc" },
        select: {
          code: true,
          name: true,
          scoreMin: true,
          scoreMax: true,
          slaPolicy: {
            select: {
              name: true,
              firstResponseMinutes: true,
              healthyMaxSeconds: true,
              attentionMaxSeconds: true,
            },
          },
        },
      }),
      options.database.pipeline.findMany({
        where: {
          workspaceId: context.workspaceId,
          entityType: "LEAD",
          deletedAt: null,
          stages: { some: { type: "OPEN", deletedAt: null } },
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, isDefault: true },
      }),
      sellerWhere
        ? options.database.workspaceMember.findMany({
            where: sellerWhere,
            orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
            select: { id: true, user: { select: { displayName: true } } },
          })
        : Promise.resolve([]),
    ]);

    return {
      timeZone: workspace.timeZone,
      sources,
      campaigns: campaigns
        .filter((campaign) => campaign.externalRef)
        .map((campaign) => ({
          externalRef: campaign.externalRef!,
          name: campaign.name,
          creatives: campaign.creatives
            .filter((creative) => creative.externalRef)
            .map((creative) => ({
              externalRef: creative.externalRef!,
              name: creative.name,
            })),
        })),
      priorityBands,
      pipelines,
      sellers: sellers.map(({ id, user }) => ({ id, name: user.displayName })),
    };
  }

  async function createManual(payload: unknown, context: AuthenticatedContext) {
    const parsed = manualLeadEntryRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        outcome: "REJECTED" as const,
        code: "INVALID_PAYLOAD" as const,
        issues: issuesFromZod(parsed.error),
      };
    }

    try {
      if (parsed.data.ownerMemberId) {
        await options.authorization.assertAuthorized(
          context,
          PermissionKeys.LEADS_ASSIGN,
          {
            workspaceId: context.workspaceId,
            resourceType: "WorkspaceMember",
            resourceId: parsed.data.ownerMemberId,
            memberId: parsed.data.ownerMemberId,
          },
        );
      }
      return await options.intake.intake(
        toLeadIntakeInput(parsed.data.lead, {
          channel: "MANUAL",
          idempotencyKey: `manual:${parsed.data.idempotencyKey}`,
          rawPayload: payload as Record<string, unknown>,
          ...(parsed.data.pipelineId ? { pipelineId: parsed.data.pipelineId } : {}),
          ...(parsed.data.ownerMemberId
            ? { ownerMemberId: parsed.data.ownerMemberId }
            : {}),
        }),
        context,
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Informe o orçamento")) {
        return {
          outcome: "REJECTED" as const,
          code: "INVALID_PAYLOAD" as const,
          issues: [{ field: "lead.budgetBrl", message: error.message }],
        };
      }
      throw error;
    }
  }

  async function simulate(payload: unknown, context: AuthenticatedContext) {
    const parsed = simulatorRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        outcome: "REJECTED" as const,
        code: "INVALID_PAYLOAD" as const,
        issues: issuesFromZod(parsed.error),
      };
    }

    await authorize(context);
    const results: Array<{
      simulated: true;
      scenario: typeof parsed.data.scenario;
      result: LeadIntakeResult;
    }> = [];
    const priorityBandCode =
      parsed.data.scenario === "DUPLICATE" ? "P2" : parsed.data.scenario;

    async function withPersistedSla(result: LeadIntakeResult) {
      if (result.outcome === "REJECTED") return result;
      const cycle = await options.database.leadSlaCycle.findFirstOrThrow({
        where: {
          id: result.slaCycleId,
          workspaceId: context.workspaceId,
        },
        select: {
          receivedAt: true,
          assignedAt: true,
          automaticAcknowledgedAt: true,
          firstHumanAttemptAt: true,
          firstConnectedAt: true,
          firstResponseTimeSeconds: true,
          firstHumanAttemptSeconds: true,
          priorityBand: {
            select: {
              slaPolicy: {
                select: {
                  name: true,
                  firstResponseMinutes: true,
                  healthyMaxSeconds: true,
                  attentionMaxSeconds: true,
                },
              },
            },
          },
        },
      });
      return {
        ...result,
        sla: {
          ...cycle.priorityBand.slaPolicy,
          receivedAt: cycle.receivedAt.toISOString(),
          assignedAt: cycle.assignedAt.toISOString(),
          automaticAcknowledgedAt:
            cycle.automaticAcknowledgedAt.toISOString(),
          firstHumanAttemptAt: cycle.firstHumanAttemptAt?.toISOString() ?? null,
          firstConnectedAt: cycle.firstConnectedAt?.toISOString() ?? null,
          firstResponseTimeSeconds: cycle.firstResponseTimeSeconds,
          firstHumanAttemptSeconds: cycle.firstHumanAttemptSeconds,
        },
      };
    }

    for (let index = 0; index < parsed.data.count; index += 1) {
      const phone = simulatedPhone(parsed.data.seed, index);
      const fields = leadEntryFieldsSchema.parse({
        fullName: `Lead simulado ${parsed.data.scenario} ${index + 1}`,
        phone,
        email: `lead-${createHash("sha1").update(`${parsed.data.seed}:${index}`).digest("hex").slice(0, 10)}@example.invalid`,
        jobTitle:
          priorityBandCode === "P1"
            ? "Diretor fictício"
            : priorityBandCode === "P2"
              ? "Contato fictício"
              : undefined,
        organizationName:
          priorityBandCode === "P3" ? undefined : "Organização simulada",
        city: parsed.data.city ?? "São Paulo",
        stateCode: parsed.data.stateCode ?? "SP",
        interestSummary:
          priorityBandCode === "P3"
            ? "Apenas conhecer; cenário controlado inteiramente fictício."
            : `Dor explícita no cenário controlado ${parsed.data.scenario}; dado inteiramente fictício.`,
        budgetBrl:
          priorityBandCode === "P1"
            ? "12000,00"
            : priorityBandCode === "P2"
              ? "3000,00"
              : "0,00",
        sourceKey: parsed.data.sourceKey,
        campaignExternalRef: parsed.data.campaignExternalRef,
        creativeExternalRef: parsed.data.creativeExternalRef,
        consent: true,
        priorityBandCode,
      });
      const baseKey = `simulator:${parsed.data.seed}:${index}`;
      const first = await options.intake.intake(
        toLeadIntakeInput(fields, {
          channel: "SIMULATOR",
          idempotencyKey: `${baseKey}:initial`,
          formIdentifier: "crm07-controlled-simulator",
          rawPayload: {
            simulation: true,
            scenario: parsed.data.scenario,
            seed: parsed.data.seed,
            index,
          },
        }),
        context,
      );

      if (parsed.data.scenario === "DUPLICATE" && first.outcome !== "REJECTED") {
        const duplicate = await options.intake.intake(
          toLeadIntakeInput(
            { ...fields, interestSummary: "Nova conversão fictícia para validar duplicidade." },
            {
              channel: "SIMULATOR",
              idempotencyKey: `${baseKey}:duplicate`,
              formIdentifier: "crm07-controlled-simulator",
              rawPayload: {
                simulation: true,
                scenario: "DUPLICATE",
                seed: parsed.data.seed,
                index,
                duplicateOfSubmissionId: first.submissionId,
              },
            },
          ),
          context,
        );
        results.push({
          simulated: true,
          scenario: parsed.data.scenario,
          result: await withPersistedSla(duplicate),
        });
      } else {
        results.push({
          simulated: true,
          scenario: parsed.data.scenario,
          result: await withPersistedSla(first),
        });
      }
    }

    return { outcome: "SIMULATED" as const, simulated: true as const, results };
  }

  return Object.freeze({ getOptions, createManual, simulate });
}

let leadEntryService: ReturnType<typeof createLeadEntryService> | undefined;

export function getLeadEntryService() {
  leadEntryService ??= createLeadEntryService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    intake: getLeadIntakeService(),
  });
  return leadEntryService;
}
