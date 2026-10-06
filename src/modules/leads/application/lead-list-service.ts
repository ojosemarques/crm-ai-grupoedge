import type {
  PermissionScope,
  PrismaClient,
} from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { staleContactCutoff } from "@/modules/leads/domain/lead-operational-policy";
import {
  defaultLeadListColumns,
  leadListColumnKeys,
  type LeadListColumnKey,
  type LeadListQuery,
  type LeadListRow,
  type SavedLeadView,
} from "@/modules/leads/domain/lead-list-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const leadStatuses = [
  "OPEN",
  "QUALIFIED",
  "DISQUALIFIED",
  "CONVERTED",
  "LOST",
] as const;
const priorityCodes = ["P1", "P2", "P3"] as const;
const slaFilters = [
  "ALL",
  "HEALTHY",
  "ATTENTION",
  "CRITICAL",
  "WITH_ATTEMPT",
  "WITHOUT_ATTEMPT",
] as const;
const capacityFilters = [
  "ALL",
  "UNKNOWN",
  "KNOWN",
  "UP_TO_5000",
  "FROM_5000_TO_10000",
  "ABOVE_10000",
] as const;
const decisionMakerFilters = [
  "ALL",
  "UNKNOWN",
  "NEGATIVE",
  "PARTIAL",
  "POSITIVE",
] as const;
const nextActionFilters = [
  "ALL",
  "OVERDUE",
  "TODAY",
  "FUTURE",
  "MISSING",
] as const;
const operationalBuckets = [
  "ALL",
  "NOW",
  "NEW",
  "P1",
  "WAITING_CALL",
  "RESPONDED",
  "RETURN_TODAY",
  "OVERDUE",
  "MEETINGS_TODAY",
  "STALE_CONTACT",
  "MISSING_NEXT_ACTION",
] as const;
const sortKeys = [
  "operational",
  "name",
  "priority",
  "score",
  "responsible",
  "source",
  "stage",
  "sla",
  "receivedAt",
  "lastActivity",
  "nextAction",
] as const;

const rawQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
  responsibles: z.unknown().optional(),
  teams: z.unknown().optional(),
  priorities: z.unknown().optional(),
  scoreMin: z.union([z.string(), z.number()]).nullish(),
  scoreMax: z.union([z.string(), z.number()]).nullish(),
  stages: z.unknown().optional(),
  statuses: z.unknown().optional(),
  sla: z.unknown().optional(),
  sources: z.unknown().optional(),
  campaigns: z.unknown().optional(),
  creatives: z.unknown().optional(),
  jobTitle: z.string().trim().max(200).optional().default(""),
  state: z.string().trim().max(2).optional().default(""),
  city: z.string().trim().max(200).optional().default(""),
  pain: z.string().trim().max(500).optional().default(""),
  capacity: z.unknown().optional(),
  decisionMaker: z.unknown().optional(),
  enteredFrom: z.string().trim().optional().default(""),
  enteredTo: z.string().trim().optional().default(""),
  lastActivityFrom: z.string().trim().optional().default(""),
  lastActivityTo: z.string().trim().optional().default(""),
  nextAction: z.unknown().optional(),
  nextActionFrom: z.string().trim().optional().default(""),
  nextActionTo: z.string().trim().optional().default(""),
  disqualificationReasons: z.unknown().optional(),
  lossReasons: z.unknown().optional(),
  operationalBucket: z.unknown().optional(),
  sort: z.unknown().optional(),
  direction: z.unknown().optional(),
  columns: z.unknown().optional(),
});

const savedViewInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  query: z.unknown(),
});

const bulkRedistributionSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(100),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("MEMBER"), memberId: z.string().uuid() }),
    z.object({ type: z.literal("GENERAL_QUEUE") }),
  ]),
  reason: z.string().trim().min(3).max(500),
});

export type LeadVisibilityAuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type DistributionPort = Readonly<{
  redistribute: ReturnType<typeof getLeadDistributionService>["redistribute"];
}>;

type LeadListServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: LeadVisibilityAuthorizationPort;
  distribution: DistributionPort;
  now: () => Date;
}>;

export type LeadVisibilityScope = Readonly<{
  scope: PermissionScope;
  teamIds: readonly string[];
}>;

type RawLeadListRow = Omit<
  LeadListRow,
  | "budgetCents"
  | "receivedAt"
  | "lastActivityAt"
  | "firstHumanAttemptAt"
  | "nextActionAt"
  | "responsibleType"
> &
  Readonly<{
    budgetCents: bigint | null;
    receivedAt: Date;
    lastActivityAt: Date;
    firstHumanAttemptAt: Date | null;
    nextActionAt: Date | null;
    responsibleType: string;
  }>;

function invalidInput(error: z.ZodError | string): never {
  throw new ApplicationError(
    typeof error === "string"
      ? error
      : error.issues.map((issue) => issue.message).join(" "),
    { code: "INVALID_INPUT", statusCode: 400, expose: true },
  );
}

function notFound(message: string): never {
  throw new ApplicationError(message, {
    code: "NOT_FOUND",
    statusCode: 404,
    expose: true,
  });
}

function conflict(code: string, message: string): never {
  throw new ApplicationError(message, {
    code,
    statusCode: 409,
    expose: true,
  });
}

function rawList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(entries.map(String).map((item) => item.trim()).filter(Boolean))];
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  const parsed = typeof value === "string" ? value : "";
  if (!parsed) return fallback;
  if (!allowed.includes(parsed)) invalidInput(`Valor de filtro inválido: ${parsed}.`);
  return parsed as T[number];
}

function enumList<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number][] {
  const parsed = rawList(value);
  const invalid = parsed.find((item) => !allowed.includes(item));
  if (invalid) invalidInput(`Valor de filtro inválido: ${invalid}.`);
  return parsed as T[number][];
}

function uuidList(value: unknown): string[] {
  const parsed = rawList(value);
  const invalid = parsed.find((item) => !z.string().uuid().safeParse(item).success);
  if (invalid) invalidInput("Um identificador de filtro é inválido.");
  return parsed;
}

function nullableScore(
  value: string | number | null | undefined,
  name: string,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    invalidInput(`${name} deve ser um inteiro entre 0 e 100.`);
  }
  return parsed;
}

function isoDate(value: string, name: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) invalidInput(`${name} contém uma data inválida.`);
  return parsed.toISOString();
}

function responsibleList(value: unknown): string[] {
  const parsed = rawList(value);
  const invalid = parsed.find((item) => {
    const [type, id, extra] = item.split(":");
    return (
      Boolean(extra) ||
      typeof type !== "string" ||
      !["member", "queue"].includes(type) ||
      typeof id !== "string" ||
      !z.string().uuid().safeParse(id).success
    );
  });
  if (invalid) invalidInput("Um responsável selecionado é inválido.");
  return parsed;
}

export function parseLeadListQuery(payload: unknown): LeadListQuery {
  const parsed = rawQuerySchema.safeParse(payload);
  if (!parsed.success) invalidInput(parsed.error);
  const scoreMin = nullableScore(parsed.data.scoreMin, "Pontuação mínima");
  const scoreMax = nullableScore(parsed.data.scoreMax, "Pontuação máxima");
  if (scoreMin !== null && scoreMax !== null && scoreMin > scoreMax) {
    invalidInput("A pontuação mínima não pode superar a máxima.");
  }
  const requestedColumns = enumList(
    parsed.data.columns,
    leadListColumnKeys,
  ) as LeadListColumnKey[];
  const columns = [
    "name" as const,
    ...requestedColumns.filter((column) => column !== "name"),
  ];

  return Object.freeze({
    q: parsed.data.q,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    responsibles: responsibleList(parsed.data.responsibles),
    teams: uuidList(parsed.data.teams),
    priorities: enumList(parsed.data.priorities, priorityCodes),
    scoreMin,
    scoreMax,
    stages: uuidList(parsed.data.stages),
    statuses: enumList(parsed.data.statuses, leadStatuses),
    sla: enumValue(parsed.data.sla, slaFilters, "ALL"),
    sources: uuidList(parsed.data.sources),
    campaigns: uuidList(parsed.data.campaigns),
    creatives: uuidList(parsed.data.creatives),
    jobTitle: parsed.data.jobTitle,
    state: parsed.data.state.toUpperCase(),
    city: parsed.data.city,
    pain: parsed.data.pain,
    capacity: enumValue(parsed.data.capacity, capacityFilters, "ALL"),
    decisionMaker: enumValue(
      parsed.data.decisionMaker,
      decisionMakerFilters,
      "ALL",
    ),
    enteredFrom: isoDate(parsed.data.enteredFrom, "Período de entrada"),
    enteredTo: isoDate(parsed.data.enteredTo, "Período de entrada"),
    lastActivityFrom: isoDate(
      parsed.data.lastActivityFrom,
      "Período de última atividade",
    ),
    lastActivityTo: isoDate(
      parsed.data.lastActivityTo,
      "Período de última atividade",
    ),
    nextAction: enumValue(parsed.data.nextAction, nextActionFilters, "ALL"),
    nextActionFrom: isoDate(
      parsed.data.nextActionFrom,
      "Período de próxima ação",
    ),
    nextActionTo: isoDate(parsed.data.nextActionTo, "Período de próxima ação"),
    disqualificationReasons: uuidList(parsed.data.disqualificationReasons),
    lossReasons: uuidList(parsed.data.lossReasons),
    operationalBucket: enumValue(
      parsed.data.operationalBucket,
      operationalBuckets,
      "ALL",
    ),
    sort: enumValue(parsed.data.sort, sortKeys, "operational"),
    direction: enumValue(parsed.data.direction, ["asc", "desc"] as const, "asc"),
    columns:
      requestedColumns.length === 0 ? [...defaultLeadListColumns] : columns,
  });
}

function uuidSql(id: string): Prisma.Sql {
  return Prisma.sql`${id}::uuid`;
}

function uuidInSql(ids: readonly string[]): Prisma.Sql {
  return Prisma.sql`(${Prisma.join(ids.map(uuidSql))})`;
}

export function leadVisibilitySql(
  context: AuthenticatedContext,
  scope: LeadVisibilityScope,
): Prisma.Sql {
  if (scope.scope === "WORKSPACE") return Prisma.sql`TRUE`;
  const teamConditions =
    scope.teamIds.length === 0
      ? []
      : [
          Prisma.sql`EXISTS (
            SELECT 1 FROM "queues" scoped_queue
            WHERE scoped_queue."workspaceId" = l."workspaceId"
              AND scoped_queue."id" = l."queueId"
              AND scoped_queue."teamId" IN ${uuidInSql(scope.teamIds)}
          )`,
          ...(scope.scope === "TEAM"
            ? [
                Prisma.sql`EXISTS (
                  SELECT 1 FROM "queues" scoped_routing_queue
                  WHERE scoped_routing_queue."workspaceId" = l."workspaceId"
                    AND scoped_routing_queue."id" = l."routingQueueId"
                    AND scoped_routing_queue."teamId" IN ${uuidInSql(scope.teamIds)}
                )`,
                Prisma.sql`EXISTS (
                  SELECT 1 FROM "team_members" scoped_team_member
                  WHERE scoped_team_member."workspaceId" = l."workspaceId"
                    AND scoped_team_member."workspaceMemberId" = l."ownerMemberId"
                    AND scoped_team_member."teamId" IN ${uuidInSql(scope.teamIds)}
                    AND scoped_team_member."deletedAt" IS NULL
                )`,
              ]
            : []),
        ];

  return Prisma.sql`(
    l."ownerMemberId" = ${context.memberId}::uuid
    ${teamConditions.length > 0 ? Prisma.sql`OR ${Prisma.join(teamConditions, " OR ")}` : Prisma.empty}
  )`;
}

export function leadVisibilityWhere(
  context: AuthenticatedContext,
  scope: LeadVisibilityScope,
): Prisma.LeadWhereInput {
  if (scope.scope === "WORKSPACE") return {};
  const teamOr: Prisma.LeadWhereInput[] = scope.teamIds.length
    ? [
        { queue: { teamId: { in: [...scope.teamIds] } } },
        ...(scope.scope === "TEAM"
          ? [
              {
                routingQueue: { teamId: { in: [...scope.teamIds] } },
              } satisfies Prisma.LeadWhereInput,
              {
                owner: {
                  teamMemberships: {
                    some: {
                      teamId: { in: [...scope.teamIds] },
                      deletedAt: null,
                    },
                  },
                },
              } satisfies Prisma.LeadWhereInput,
            ]
          : []),
      ]
    : [];
  return { OR: [{ ownerMemberId: context.memberId }, ...teamOr] };
}

function effectiveSourceSql(): Prisma.Sql {
  return Prisma.sql`
    FROM "leads" l
    JOIN "pipeline_stages" stage
      ON stage."workspaceId" = l."workspaceId" AND stage."id" = l."currentStageId"
    JOIN "pipelines" pipeline
      ON pipeline."workspaceId" = l."workspaceId" AND pipeline."id" = l."pipelineId"
    JOIN "lead_sources" source
      ON source."workspaceId" = l."workspaceId"
      AND source."id" = COALESCE(l."latestSourceId", l."sourceId")
    LEFT JOIN "acquisition_campaigns" campaign
      ON campaign."workspaceId" = l."workspaceId"
      AND campaign."id" = COALESCE(l."latestCampaignId", l."campaignId")
    LEFT JOIN "acquisition_creatives" creative
      ON creative."workspaceId" = l."workspaceId"
      AND creative."id" = COALESCE(l."latestCreativeId", l."creativeId")
    LEFT JOIN "workspace_members" owner
      ON owner."workspaceId" = l."workspaceId" AND owner."id" = l."ownerMemberId"
    LEFT JOIN "users" owner_user ON owner_user."id" = owner."userId"
    LEFT JOIN "queues" responsible_queue
      ON responsible_queue."workspaceId" = l."workspaceId"
      AND responsible_queue."id" = l."queueId"
    LEFT JOIN "queues" routing_queue
      ON routing_queue."workspaceId" = l."workspaceId"
      AND routing_queue."id" = l."routingQueueId"
    LEFT JOIN "teams" routing_team
      ON routing_team."workspaceId" = l."workspaceId"
      AND routing_team."id" = COALESCE(routing_queue."teamId", responsible_queue."teamId")
    LEFT JOIN LATERAL (
      SELECT team."name"
      FROM "team_members" membership
      JOIN "teams" team
        ON team."workspaceId" = membership."workspaceId"
        AND team."id" = membership."teamId"
      WHERE membership."workspaceId" = l."workspaceId"
        AND membership."workspaceMemberId" = l."ownerMemberId"
        AND membership."deletedAt" IS NULL
        AND team."deletedAt" IS NULL
      ORDER BY team."name", team."id"
      LIMIT 1
    ) owner_team ON TRUE
    LEFT JOIN "lead_qualifications" qualification
      ON qualification."workspaceId" = l."workspaceId"
      AND qualification."leadId" = l."id"
    LEFT JOIN "disqualification_reasons" disqualification_reason
      ON disqualification_reason."workspaceId" = l."workspaceId"
      AND disqualification_reason."id" = l."disqualificationReasonId"
    LEFT JOIN "lead_current_scores" current_score
      ON current_score."workspaceId" = l."workspaceId"
      AND current_score."leadId" = l."id"
    LEFT JOIN "lead_scores" latest_score
      ON latest_score."workspaceId" = current_score."workspaceId"
      AND latest_score."leadId" = current_score."leadId"
      AND latest_score."id" = current_score."leadScoreId"
    LEFT JOIN LATERAL (
      SELECT
        cycle_row."id",
        cycle_row."receivedAt",
        cycle_row."firstHumanAttemptAt",
        cycle_row."firstHumanAttemptSeconds",
        priority_band."code"::text AS "priorityCode",
        priority_band."name" AS "priorityName",
        policy."healthyMaxSeconds",
        policy."attentionMaxSeconds"
      FROM "lead_sla_cycles" cycle_row
      JOIN "lead_priority_bands" priority_band
        ON priority_band."workspaceId" = cycle_row."workspaceId"
        AND priority_band."id" = cycle_row."priorityBandId"
      JOIN "sla_policies" policy
        ON policy."workspaceId" = priority_band."workspaceId"
        AND policy."id" = priority_band."slaPolicyId"
      WHERE cycle_row."workspaceId" = l."workspaceId"
        AND cycle_row."leadId" = l."id"
      ORDER BY cycle_row."receivedAt" DESC, cycle_row."id" DESC
      LIMIT 1
    ) latest_cycle ON TRUE
    LEFT JOIN LATERAL (
      SELECT activity."subject", activity."occurredAt"
      FROM "activities" activity
      WHERE activity."workspaceId" = l."workspaceId"
        AND activity."leadId" = l."id"
        AND activity."deletedAt" IS NULL
      ORDER BY activity."occurredAt" DESC, activity."id" DESC
      LIMIT 1
    ) latest_activity ON TRUE
    LEFT JOIN LATERAL (
      SELECT loss_reason."name" AS "lossReason"
      FROM "opportunities" opportunity
      LEFT JOIN "loss_reasons" loss_reason
        ON loss_reason."workspaceId" = opportunity."workspaceId"
        AND loss_reason."id" = opportunity."lossReasonId"
      WHERE opportunity."workspaceId" = l."workspaceId"
        AND opportunity."leadId" = l."id"
        AND opportunity."status"::text = 'LOST'
        AND opportunity."deletedAt" IS NULL
      ORDER BY opportunity."closedAt" DESC NULLS LAST, opportunity."createdAt" DESC, opportunity."id" DESC
      LIMIT 1
    ) latest_loss ON TRUE
  `;
}

function slaSecondsSql(now: Date): Prisma.Sql {
  return Prisma.sql`COALESCE(
    latest_cycle."firstHumanAttemptSeconds",
    GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (${now}::timestamptz - latest_cycle."receivedAt")))::integer
    )
  )`;
}

function filtersSql(
  context: AuthenticatedContext,
  scope: LeadVisibilityScope,
  query: LeadListQuery,
  now: Date,
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`l."workspaceId" = ${context.workspaceId}::uuid`,
    Prisma.sql`l."deletedAt" IS NULL`,
    leadVisibilitySql(context, scope),
  ];
  const addUuidFilter = (column: Prisma.Sql, values: readonly string[]) => {
    if (values.length) clauses.push(Prisma.sql`${column} IN ${uuidInSql(values)}`);
  };

  if (query.q) {
    const pattern = `%${query.q}%`;
    clauses.push(Prisma.sql`(
      l."fullName" ILIKE ${pattern}
      OR COALESCE(l."normalizedEmail", '') ILIKE ${pattern}
      OR COALESCE(l."normalizedPhone", '') ILIKE ${pattern}
      OR COALESCE(l."organizationName", '') ILIKE ${pattern}
    )`);
  }
  if (query.responsibles.length) {
    const memberIds = query.responsibles
      .filter((item) => item.startsWith("member:"))
      .map((item) => item.slice(7));
    const queueIds = query.responsibles
      .filter((item) => item.startsWith("queue:"))
      .map((item) => item.slice(6));
    const responsibleClauses: Prisma.Sql[] = [];
    if (memberIds.length) {
      responsibleClauses.push(Prisma.sql`l."ownerMemberId" IN ${uuidInSql(memberIds)}`);
    }
    if (queueIds.length) {
      responsibleClauses.push(Prisma.sql`l."queueId" IN ${uuidInSql(queueIds)}`);
    }
    clauses.push(Prisma.sql`(${Prisma.join(responsibleClauses, " OR ")})`);
  }
  if (query.teams.length) {
    clauses.push(Prisma.sql`(
      routing_queue."teamId" IN ${uuidInSql(query.teams)}
      OR responsible_queue."teamId" IN ${uuidInSql(query.teams)}
      OR EXISTS (
        SELECT 1 FROM "team_members" selected_team_member
        WHERE selected_team_member."workspaceId" = l."workspaceId"
          AND selected_team_member."workspaceMemberId" = l."ownerMemberId"
          AND selected_team_member."teamId" IN ${uuidInSql(query.teams)}
          AND selected_team_member."deletedAt" IS NULL
      )
    )`);
  }
  if (query.priorities.length) {
    clauses.push(
      Prisma.sql`COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") IN (${Prisma.join(query.priorities)})`,
    );
  }
  if (query.scoreMin !== null) {
    clauses.push(Prisma.sql`latest_score."score" >= ${query.scoreMin}`);
  }
  if (query.scoreMax !== null) {
    clauses.push(Prisma.sql`latest_score."score" <= ${query.scoreMax}`);
  }
  addUuidFilter(Prisma.sql`l."currentStageId"`, query.stages);
  if (query.statuses.length) {
    clauses.push(
      Prisma.sql`l."status"::text IN (${Prisma.join(query.statuses)})`,
    );
  }
  const seconds = slaSecondsSql(now);
  if (query.sla === "HEALTHY") {
    clauses.push(
      Prisma.sql`latest_cycle."id" IS NOT NULL AND ${seconds} <= latest_cycle."healthyMaxSeconds"`,
    );
  } else if (query.sla === "ATTENTION") {
    clauses.push(
      Prisma.sql`latest_cycle."id" IS NOT NULL AND ${seconds} > latest_cycle."healthyMaxSeconds" AND ${seconds} <= latest_cycle."attentionMaxSeconds"`,
    );
  } else if (query.sla === "CRITICAL") {
    clauses.push(
      Prisma.sql`latest_cycle."id" IS NOT NULL AND ${seconds} > latest_cycle."attentionMaxSeconds"`,
    );
  } else if (query.sla === "WITH_ATTEMPT") {
    clauses.push(Prisma.sql`latest_cycle."firstHumanAttemptAt" IS NOT NULL`);
  } else if (query.sla === "WITHOUT_ATTEMPT") {
    clauses.push(Prisma.sql`latest_cycle."firstHumanAttemptAt" IS NULL`);
  }
  addUuidFilter(
    Prisma.sql`COALESCE(l."latestSourceId", l."sourceId")`,
    query.sources,
  );
  addUuidFilter(
    Prisma.sql`COALESCE(l."latestCampaignId", l."campaignId")`,
    query.campaigns,
  );
  addUuidFilter(
    Prisma.sql`COALESCE(l."latestCreativeId", l."creativeId")`,
    query.creatives,
  );
  if (query.jobTitle) clauses.push(Prisma.sql`l."jobTitle" ILIKE ${query.jobTitle}`);
  if (query.state) clauses.push(Prisma.sql`l."stateCode" = ${query.state}`);
  if (query.city) clauses.push(Prisma.sql`l."city" ILIKE ${query.city}`);
  if (query.pain) clauses.push(Prisma.sql`COALESCE(l."interestSummary", l."latestInterestSummary", '') ILIKE ${`%${query.pain}%`}`);
  if (query.capacity === "UNKNOWN") clauses.push(Prisma.sql`l."budgetCents" IS NULL`);
  if (query.capacity === "KNOWN") clauses.push(Prisma.sql`l."budgetCents" IS NOT NULL`);
  if (query.capacity === "UP_TO_5000") clauses.push(Prisma.sql`l."budgetCents" BETWEEN 0 AND 500000`);
  if (query.capacity === "FROM_5000_TO_10000") clauses.push(Prisma.sql`l."budgetCents" > 500000 AND l."budgetCents" <= 1000000`);
  if (query.capacity === "ABOVE_10000") clauses.push(Prisma.sql`l."budgetCents" > 1000000`);
  if (query.decisionMaker !== "ALL") {
    clauses.push(
      Prisma.sql`COALESCE(qualification."authorityStatus"::text, 'UNKNOWN') = ${query.decisionMaker}`,
    );
  }
  if (query.enteredFrom) clauses.push(Prisma.sql`COALESCE(latest_cycle."receivedAt", l."createdAt") >= ${new Date(query.enteredFrom)}`);
  if (query.enteredTo) clauses.push(Prisma.sql`COALESCE(latest_cycle."receivedAt", l."createdAt") <= ${new Date(query.enteredTo)}`);
  if (query.lastActivityFrom) clauses.push(Prisma.sql`l."lastActivityAt" >= ${new Date(query.lastActivityFrom)}`);
  if (query.lastActivityTo) clauses.push(Prisma.sql`l."lastActivityAt" <= ${new Date(query.lastActivityTo)}`);
  if (query.nextAction === "OVERDUE") clauses.push(Prisma.sql`l."nextActionAt" < ${now}`);
  if (query.nextAction === "TODAY") {
    const tomorrow = new Date(now.getTime() + 86_400_000);
    clauses.push(Prisma.sql`l."nextActionAt" >= ${now} AND l."nextActionAt" < ${tomorrow}`);
  }
  if (query.nextAction === "FUTURE") clauses.push(Prisma.sql`l."nextActionAt" >= ${now}`);
  if (query.nextAction === "MISSING") clauses.push(Prisma.sql`l."nextActionAt" IS NULL`);
  if (query.nextActionFrom) clauses.push(Prisma.sql`l."nextActionAt" >= ${new Date(query.nextActionFrom)}`);
  if (query.nextActionTo) clauses.push(Prisma.sql`l."nextActionAt" <= ${new Date(query.nextActionTo)}`);
  addUuidFilter(Prisma.sql`l."disqualificationReasonId"`, query.disqualificationReasons);
  if (query.lossReasons.length) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "opportunities" filtered_opportunity
      WHERE filtered_opportunity."workspaceId" = l."workspaceId"
        AND filtered_opportunity."leadId" = l."id"
        AND filtered_opportunity."lossReasonId" IN ${uuidInSql(query.lossReasons)}
        AND filtered_opportunity."status"::text = 'LOST'
        AND filtered_opportunity."deletedAt" IS NULL
    )`);
  }
  const openLead = Prisma.sql`l."status"::text IN ('OPEN', 'QUALIFIED')`;
  if (query.operationalBucket === "NOW") {
    clauses.push(openLead);
  } else if (query.operationalBucket === "NEW") {
    clauses.push(Prisma.sql`${openLead} AND stage."position" = 0`);
  } else if (query.operationalBucket === "P1") {
    clauses.push(Prisma.sql`${openLead} AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P1'`);
  } else if (query.operationalBucket === "WAITING_CALL") {
    clauses.push(Prisma.sql`${openLead} AND EXISTS (
      SELECT 1 FROM "tasks" bucket_task
      WHERE bucket_task."workspaceId" = l."workspaceId"
        AND bucket_task."leadId" = l."id"
        AND bucket_task."kind"::text IN ('IMMEDIATE_CALL', 'CALL')
        AND bucket_task."status"::text IN ('OPEN', 'IN_PROGRESS')
        AND bucket_task."deletedAt" IS NULL
    )`);
  } else if (query.operationalBucket === "RESPONDED") {
    clauses.push(Prisma.sql`${openLead} AND l."awaitingHumanResponse" = TRUE`);
  } else if (query.operationalBucket === "RETURN_TODAY") {
    clauses.push(Prisma.sql`${openLead} AND l."nextActionAt" IS NOT NULL AND
      (l."nextActionAt" AT TIME ZONE (
        SELECT bucket_workspace."timeZone" FROM "workspaces" bucket_workspace
        WHERE bucket_workspace."id" = l."workspaceId"
      ))::date = (${now}::timestamptz AT TIME ZONE (
        SELECT bucket_workspace."timeZone" FROM "workspaces" bucket_workspace
        WHERE bucket_workspace."id" = l."workspaceId"
      ))::date`);
  } else if (query.operationalBucket === "OVERDUE") {
    clauses.push(Prisma.sql`${openLead} AND l."nextActionAt" < ${now}`);
  } else if (query.operationalBucket === "MEETINGS_TODAY") {
    clauses.push(Prisma.sql`${openLead} AND EXISTS (
      SELECT 1 FROM "meetings" bucket_meeting
      JOIN "workspaces" bucket_workspace
        ON bucket_workspace."id" = bucket_meeting."workspaceId"
      WHERE bucket_meeting."workspaceId" = l."workspaceId"
        AND bucket_meeting."leadId" = l."id"
        AND bucket_meeting."status"::text <> 'CANCELLED'
        AND bucket_meeting."deletedAt" IS NULL
        AND (bucket_meeting."startsAt" AT TIME ZONE bucket_workspace."timeZone")::date
          = (${now}::timestamptz AT TIME ZONE bucket_workspace."timeZone")::date
    )`);
  } else if (query.operationalBucket === "STALE_CONTACT") {
    clauses.push(Prisma.sql`${openLead} AND NOT EXISTS (
      SELECT 1 FROM "activities" bucket_contact
      WHERE bucket_contact."workspaceId" = l."workspaceId"
        AND bucket_contact."leadId" = l."id"
        AND bucket_contact."occurredAt" >= ${staleContactCutoff(now)}
        AND bucket_contact."type"::text IN ('CALL', 'CALL_CONNECTED', 'CALL_UNANSWERED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'EMAIL')
        AND bucket_contact."deletedAt" IS NULL
    )`);
  } else if (query.operationalBucket === "MISSING_NEXT_ACTION") {
    clauses.push(Prisma.sql`${openLead} AND l."nextActionAt" IS NULL`);
  }
  return Prisma.sql`${Prisma.join(clauses, " AND ")}`;
}

function sortSql(query: LeadListQuery, now: Date): Prisma.Sql {
  const direction = query.direction === "desc" ? Prisma.raw("DESC") : Prisma.raw("ASC");
  const expressions: Readonly<Record<Exclude<LeadListQuery["sort"], "operational">, Prisma.Sql>> = {
    name: Prisma.sql`LOWER(l."fullName")`,
    priority: Prisma.sql`CASE COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END`,
    score: Prisma.sql`latest_score."score"`,
    responsible: Prisma.sql`LOWER(COALESCE(owner_user."displayName", responsible_queue."name"))`,
    source: Prisma.sql`LOWER(source."name")`,
    stage: Prisma.sql`stage."position"`,
    sla: slaSecondsSql(now),
    receivedAt: Prisma.sql`COALESCE(latest_cycle."receivedAt", l."createdAt")`,
    lastActivity: Prisma.sql`l."lastActivityAt"`,
    nextAction: Prisma.sql`l."nextActionAt"`,
  };
  if (query.sort !== "operational") {
    return Prisma.sql`${expressions[query.sort]} ${direction} NULLS LAST, l."id" ASC`;
  }
  return Prisma.sql`
    CASE
      WHEN l."awaitingHumanResponse" THEN 0
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P1' THEN 1
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P2' THEN 2
      WHEN stage."position" = 0 AND COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") = 'P3' THEN 3
      WHEN l."nextActionAt" < ${now} THEN 4
      ELSE 5
    END ASC,
    CASE WHEN l."awaitingHumanResponse" THEN l."lastInboundResponseAt" END DESC NULLS LAST,
    CASE WHEN stage."position" = 0 THEN latest_cycle."receivedAt" END ASC NULLS LAST,
    CASE WHEN l."nextActionAt" < ${now} THEN l."nextActionAt" END ASC NULLS LAST,
    l."nextActionAt" ASC NULLS LAST,
    l."createdAt" ASC,
    l."id" ASC
  `;
}

function hasActiveFilters(query: LeadListQuery): boolean {
  return Boolean(
    query.q ||
      query.responsibles.length ||
      query.teams.length ||
      query.priorities.length ||
      query.scoreMin !== null ||
      query.scoreMax !== null ||
      query.stages.length ||
      query.statuses.length ||
      query.sla !== "ALL" ||
      query.sources.length ||
      query.campaigns.length ||
      query.creatives.length ||
      query.jobTitle ||
      query.state ||
      query.city ||
      query.pain ||
      query.capacity !== "ALL" ||
      query.decisionMaker !== "ALL" ||
      query.enteredFrom ||
      query.enteredTo ||
      query.lastActivityFrom ||
      query.lastActivityTo ||
      query.nextAction !== "ALL" ||
      query.nextActionFrom ||
      query.nextActionTo ||
      query.disqualificationReasons.length ||
      query.lossReasons.length ||
      query.operationalBucket !== "ALL"
  );
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function storedQuery(query: LeadListQuery) {
  const {
    page,
    sort,
    direction,
    columns,
    ...filters
  } = query;
  void page;
  return {
    filters: jsonValue(filters),
    sorting: jsonValue({ sort, direction }),
    columns: jsonValue(columns),
  };
}

function queryFromSavedView(view: {
  filters: Prisma.JsonValue;
  sorting: Prisma.JsonValue | null;
  columns: Prisma.JsonValue | null;
}): LeadListQuery | null {
  if (!view.filters || typeof view.filters !== "object" || Array.isArray(view.filters)) return null;
  const sorting =
    view.sorting && typeof view.sorting === "object" && !Array.isArray(view.sorting)
      ? view.sorting
      : {};
  return (() => {
    try {
      return parseLeadListQuery({
        ...view.filters,
        ...sorting,
        ...(Array.isArray(view.columns) ? { columns: view.columns } : {}),
        page: 1,
      });
    } catch {
      return null;
    }
  })();
}

export async function resolveLeadVisibilityScope(
  database: PrismaClient,
  authorization: LeadVisibilityAuthorizationPort,
  context: AuthenticatedContext,
  permission: PermissionKey,
): Promise<LeadVisibilityScope> {
    const resource: ResourceScope = {
      workspaceId: context.workspaceId,
      resourceType: "LeadList",
      memberId: context.memberId,
    };
    const decision = await authorization.authorize(context, permission, resource);
    if (!decision.allowed) {
      await authorization.assertAuthorized(context, permission, resource);
      throw new Error("Unreachable authorization state.");
    }
    const teamIds = await database.teamMember.findMany({
      where: {
        workspaceId: context.workspaceId,
        workspaceMemberId: context.memberId,
        deletedAt: null,
        team: { deletedAt: null },
      },
      select: { teamId: true },
    });
    return { scope: decision.scope, teamIds: teamIds.map((item) => item.teamId) };
}

export function createLeadListService(options: LeadListServiceOptions) {
  async function resolveScope(
    context: AuthenticatedContext,
    permission: PermissionKey,
  ): Promise<LeadVisibilityScope> {
    return resolveLeadVisibilityScope(
      options.database,
      options.authorization,
      context,
      permission,
    );
  }

  async function getSavedViews(context: AuthenticatedContext): Promise<SavedLeadView[]> {
    const views = await options.database.savedView.findMany({
      where: {
        workspaceId: context.workspaceId,
        ownerMemberId: context.memberId,
        entityType: "LEAD",
        deletedAt: null,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, filters: true, sorting: true, columns: true },
    });
    return views.flatMap((view) => {
      const query = queryFromSavedView(view);
      return query ? [{ id: view.id, name: view.name, query }] : [];
    });
  }

  async function listRows(
    context: AuthenticatedContext,
    scope: LeadVisibilityScope,
    query: LeadListQuery,
  ) {
    const now = options.now();
    const from = effectiveSourceSql();
    const where = filtersSql(context, scope, query, now);
    const visibleWhere = Prisma.sql`
      l."workspaceId" = ${context.workspaceId}::uuid
      AND l."deletedAt" IS NULL
      AND ${leadVisibilitySql(context, scope)}
    `;
    const [filteredCountRows, visibleCountRows] = await Promise.all([
      options.database.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`SELECT COUNT(*)::integer AS "count" ${from} WHERE ${where}`,
      ),
      options.database.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`SELECT COUNT(*)::integer AS "count" FROM "leads" l WHERE ${visibleWhere}`,
      ),
    ]);
    const total = filteredCountRows[0]?.count ?? 0;
    const visibleTotal = visibleCountRows[0]?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const offset = (page - 1) * query.pageSize;
    const order = sortSql(query, now);
    const seconds = slaSecondsSql(now);
    const rows = await options.database.$queryRaw<RawLeadListRow[]>(Prisma.sql`
      SELECT
        l."id",
        l."fullName",
        l."normalizedPhone",
        l."normalizedEmail",
        l."jobTitle",
        l."organizationName",
        l."city",
        l."stateCode",
        COALESCE(l."latestInterestSummary", l."interestSummary") AS "interestSummary",
        l."budgetCents",
        l."status"::text AS "status",
        COALESCE(latest_score."priorityBandCode"::text, latest_cycle."priorityCode") AS "priorityCode",
        latest_score."score",
        COALESCE(latest_score."reason", latest_cycle."priorityName") AS "priorityReason",
        COALESCE(owner."id", responsible_queue."id")::text AS "responsibleId",
        COALESCE(owner_user."displayName", responsible_queue."name") AS "responsibleName",
        CASE WHEN owner."id" IS NULL THEN 'QUEUE' ELSE 'MEMBER' END AS "responsibleType",
        COALESCE(routing_team."name", owner_team."name") AS "teamName",
        source."id"::text AS "sourceId",
        source."name" AS "sourceName",
        campaign."id"::text AS "campaignId",
        campaign."name" AS "campaignName",
        creative."id"::text AS "creativeId",
        creative."name" AS "creativeName",
        pipeline."name" AS "pipelineName",
        stage."id"::text AS "stageId",
        stage."name" AS "stageName",
        CASE WHEN latest_cycle."id" IS NULL THEN NULL ELSE ${seconds} END AS "slaSeconds",
        CASE
          WHEN latest_cycle."id" IS NULL THEN 'UNKNOWN'
          WHEN ${seconds} <= latest_cycle."healthyMaxSeconds" THEN 'HEALTHY'
          WHEN ${seconds} <= latest_cycle."attentionMaxSeconds" THEN 'ATTENTION'
          ELSE 'CRITICAL'
        END AS "slaBand",
        latest_cycle."firstHumanAttemptAt",
        l."awaitingHumanResponse",
        COALESCE(latest_cycle."receivedAt", l."createdAt") AS "receivedAt",
        l."lastActivityAt",
        latest_activity."subject" AS "lastActivitySubject",
        l."nextActionAt",
        l."nextActionDescription",
        qualification."authorityStatus"::text AS "decisionMakerStatus",
        disqualification_reason."name" AS "disqualificationReason",
        latest_loss."lossReason"
      ${from}
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${query.pageSize}
      OFFSET ${offset}
    `);
    return {
      rows: rows.map((row) => ({
        ...row,
        budgetCents: row.budgetCents?.toString() ?? null,
        receivedAt: row.receivedAt.toISOString(),
        lastActivityAt: row.lastActivityAt.toISOString(),
        firstHumanAttemptAt: row.firstHumanAttemptAt?.toISOString() ?? null,
        nextActionAt: row.nextActionAt?.toISOString() ?? null,
        responsibleType: row.responsibleType === "QUEUE" ? "QUEUE" as const : "MEMBER" as const,
      })),
      page,
      pageSize: query.pageSize,
      total,
      totalPages,
      visibleTotal,
      hasActiveFilters: hasActiveFilters(query),
      generatedAt: now.toISOString(),
    };
  }

  async function getFilterOptions(
    context: AuthenticatedContext,
    scope: LeadVisibilityScope,
  ) {
    const visibility = leadVisibilityWhere(context, scope);
    const baseLeadWhere: Prisma.LeadWhereInput = {
      workspaceId: context.workspaceId,
      deletedAt: null,
      ...visibility,
    };
    const [
      workspace,
      memberIds,
      queueIds,
      assignmentTargets,
      teams,
      priorityBands,
      stages,
      sources,
      campaigns,
      creatives,
      jobTitles,
      states,
      cities,
      disqualificationReasons,
      lossReasons,
    ] = await Promise.all([
      options.database.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { timeZone: true },
      }),
      options.database.lead.findMany({
        where: { ...baseLeadWhere, ownerMemberId: { not: null } },
        distinct: ["ownerMemberId"],
        select: { ownerMemberId: true },
      }),
      options.database.lead.findMany({
        where: { ...baseLeadWhere, queueId: { not: null } },
        distinct: ["queueId"],
        select: { queueId: true },
      }),
      options.database.workspaceMember.findMany({
        where: commercialMemberWhere({
          workspaceId: context.workspaceId,
          functions: ["SDR", "CLOSER"],
          requireLeadAvailability: true,
          ...(scope.scope === "WORKSPACE" ? {} : { teamIds: scope.teamIds }),
        }),
        orderBy: { user: { displayName: "asc" } },
        select: { id: true, user: { select: { displayName: true } } },
      }),
      options.database.team.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          ...(scope.scope === "WORKSPACE" ? {} : { id: { in: [...scope.teamIds] } }),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      options.database.leadPriorityBand.findMany({
        where: { workspaceId: context.workspaceId, active: true, deletedAt: null },
        orderBy: { position: "asc" },
        select: { code: true, name: true },
      }),
      options.database.pipelineStage.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          pipeline: { entityType: "LEAD", deletedAt: null },
        },
        orderBy: [{ pipelineId: "asc" }, { position: "asc" }],
        select: { id: true, name: true },
      }),
      options.database.leadSource.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      options.database.acquisitionCampaign.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      options.database.acquisitionCreative.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, campaignId: true },
      }),
      options.database.lead.findMany({
        where: { ...baseLeadWhere, jobTitle: { not: null } },
        distinct: ["jobTitle"],
        orderBy: { jobTitle: "asc" },
        select: { jobTitle: true },
      }),
      options.database.lead.findMany({
        where: { ...baseLeadWhere, stateCode: { not: null } },
        distinct: ["stateCode"],
        orderBy: { stateCode: "asc" },
        select: { stateCode: true },
      }),
      options.database.lead.findMany({
        where: { ...baseLeadWhere, city: { not: null } },
        distinct: ["city"],
        orderBy: { city: "asc" },
        select: { city: true },
      }),
      options.database.disqualificationReason.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        orderBy: { position: "asc" },
        select: { id: true, name: true },
      }),
      options.database.lossReason.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        orderBy: { position: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    const [members, queues] = await Promise.all([
      options.database.workspaceMember.findMany({
        where: {
          workspaceId: context.workspaceId,
          id: { in: memberIds.flatMap((item) => item.ownerMemberId ? [item.ownerMemberId] : []) },
          deletedAt: null,
        },
        orderBy: { user: { displayName: "asc" } },
        select: { id: true, user: { select: { displayName: true } } },
      }),
      options.database.queue.findMany({
        where: {
          workspaceId: context.workspaceId,
          id: { in: queueIds.flatMap((item) => item.queueId ? [item.queueId] : []) },
          deletedAt: null,
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return {
      timeZone: workspace.timeZone,
      responsibles: [
        ...members.map((member) => ({ value: `member:${member.id}`, label: member.user.displayName })),
        ...queues.map((queue) => ({ value: `queue:${queue.id}`, label: queue.name })),
      ],
      assignmentTargets: assignmentTargets.map((member) => ({
        id: member.id,
        name: member.user.displayName,
      })),
      teams,
      priorities: priorityBands,
      stages,
      sources,
      campaigns,
      creatives,
      jobTitles: jobTitles.flatMap((item) => item.jobTitle ? [item.jobTitle] : []),
      states: states.flatMap((item) => item.stateCode ? [item.stateCode] : []),
      cities: cities.flatMap((item) => item.city ? [item.city] : []),
      disqualificationReasons,
      lossReasons,
    };
  }

  async function getScreen(context: AuthenticatedContext, payload: unknown) {
    const query = parseLeadListQuery(payload);
    const scope = await resolveScope(context, PermissionKeys.LEADS_READ);
    const [assignDecision, bulkDecision] = await Promise.all([
      options.authorization.authorize(
        context,
        PermissionKeys.LEADS_ASSIGN,
        { workspaceId: context.workspaceId, resourceType: "LeadBulk", memberId: context.memberId },
      ),
      options.authorization.authorize(
        context,
        PermissionKeys.BULK_ACTIONS_EXECUTE,
        { workspaceId: context.workspaceId, resourceType: "LeadBulk", memberId: context.memberId },
      ),
    ]);
    const [list, filters, savedViews] = await Promise.all([
      listRows(context, scope, query),
      getFilterOptions(context, scope),
      getSavedViews(context),
    ]);
    return { query: { ...query, page: list.page }, list, filters, savedViews, canBulkAssign: assignDecision.allowed && bulkDecision.allowed };
  }

  async function createSavedView(context: AuthenticatedContext, payload: unknown) {
    const parsed = savedViewInputSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    await resolveScope(context, PermissionKeys.LEADS_READ);
    const query = parseLeadListQuery(parsed.data.query);
    const values = storedQuery(query);
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`saved-view:${context.workspaceId}:${context.memberId}`}, 0))`;
      const duplicate = await transaction.savedView.findFirst({
        where: {
          workspaceId: context.workspaceId,
          ownerMemberId: context.memberId,
          entityType: "LEAD",
          name: { equals: parsed.data.name, mode: "insensitive" },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate) conflict("SAVED_VIEW_ALREADY_EXISTS", "Já existe uma visualização com esse nome.");
      const view = await transaction.savedView.create({
        data: {
          workspaceId: context.workspaceId,
          ownerMemberId: context.memberId,
          entityType: "LEAD",
          name: parsed.data.name,
          isShared: false,
          filters: values.filters,
          sorting: values.sorting,
          columns: values.columns,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
        },
        select: { id: true, name: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "saved_view.created",
          entityType: "SavedView",
          entityId: view.id,
          changes: { name: view.name, entityType: "LEAD" },
        },
      });
      return { ...view, query };
    });
  }

  async function deleteSavedView(
    context: AuthenticatedContext,
    savedViewId: string,
  ) {
    if (!z.string().uuid().safeParse(savedViewId).success) invalidInput("Visualização inválida.");
    await resolveScope(context, PermissionKeys.LEADS_READ);
    return options.database.$transaction(async (transaction) => {
      const view = await transaction.savedView.findFirst({
        where: {
          id: savedViewId,
          workspaceId: context.workspaceId,
          ownerMemberId: context.memberId,
          entityType: "LEAD",
          deletedAt: null,
        },
        select: { id: true, name: true },
      });
      if (!view) notFound("Visualização não encontrada.");
      const deletedAt = options.now();
      await transaction.savedView.update({
        where: { id: view.id },
        data: { deletedAt, updatedByActorId: context.actorId },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "saved_view.deleted",
          entityType: "SavedView",
          entityId: view.id,
          occurredAt: deletedAt,
          changes: { name: view.name, deletedAt },
        },
      });
      return { id: view.id };
    });
  }

  async function bulkRedistribute(context: AuthenticatedContext, payload: unknown) {
    const parsed = bulkRedistributionSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const ids = [...new Set(parsed.data.leadIds)].sort();
    await resolveScope(context, PermissionKeys.LEADS_ASSIGN);
    await options.authorization.assertAuthorized(context, PermissionKeys.BULK_ACTIONS_EXECUTE, {
      workspaceId: context.workspaceId,
      resourceType: "LeadBulk",
      memberId: context.memberId,
    });
    const leads = await options.database.lead.findMany({
      where: { id: { in: ids }, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        ownerMemberId: true,
        queueId: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
      },
    });
    if (leads.length !== ids.length) notFound("Um ou mais leads não foram encontrados.");
    await Promise.all(
      leads.map((lead) =>
        options.authorization.assertAuthorized(context, PermissionKeys.LEADS_ASSIGN, {
          workspaceId: context.workspaceId,
          resourceType: "Lead",
          resourceId: lead.id,
          ownerMemberId: lead.ownerMemberId,
          queueId: lead.queueId,
          teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
        }),
      ),
    );
    const results: Array<{ leadId: string; status: "CHANGED" | "SKIPPED"; message?: string }> = [];
    for (const leadId of ids) {
      try {
        await options.distribution.redistribute(context, {
          leadId,
          target: parsed.data.target,
          reason: parsed.data.reason,
        });
        results.push({ leadId, status: "CHANGED" });
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "NO_ASSIGNMENT_CHANGE") {
          results.push({ leadId, status: "SKIPPED", message: error.message });
          continue;
        }
        throw error;
      }
    }
    return {
      requested: ids.length,
      changed: results.filter((result) => result.status === "CHANGED").length,
      skipped: results.filter((result) => result.status === "SKIPPED").length,
      results,
    };
  }

  return Object.freeze({ getScreen, createSavedView, deleteSavedView, bulkRedistribute });
}

let leadListService: ReturnType<typeof createLeadListService> | undefined;

export function getLeadListService() {
  leadListService ??= createLeadListService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    distribution: getLeadDistributionService(),
    now: () => new Date(),
  });
  return leadListService;
}
