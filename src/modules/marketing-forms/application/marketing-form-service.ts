import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import {
  createEmptyMarketingFormDefinition,
  createMarketingFormSchema,
  MARKETING_FORM_SCHEMA_VERSION,
  marketingFormActionSchema,
  marketingFormDefinitionSchema,
  marketingFormSlugSchema,
  updateMarketingFormSchema,
  type MarketingFormDefinition,
} from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { isAllowedMarketingFormAssetUrl, marketingFormAssetOrigins } from "@/modules/marketing-forms/domain/marketing-form-assets";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function fail(message: string, code: string, statusCode: number): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(context: AuthenticatedContext, id?: string) {
  return { workspaceId: context.workspaceId, resourceType: "MarketingForm", memberId: context.memberId, ...(id ? { resourceId: id } : {}) };
}

function keyFromSlug(slug: string): string {
  return slug.slice(0, 120);
}

function parseDefinition(value: Prisma.JsonValue): MarketingFormDefinition {
  const parsed = marketingFormDefinitionSchema.safeParse(value);
  if (!parsed.success) fail("O rascunho possui campos inválidos e não pode ser publicado.", "MARKETING_FORM_DEFINITION_INVALID", 422);
  return parsed.data;
}

export function createMarketingFormService(options: Options) {
  async function authorizeRead(context: AuthenticatedContext, id?: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.MARKETING_JOURNEY_READ, resource(context, id));
  }

  async function authorizeManage(context: AuthenticatedContext, id?: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE, resource(context, id));
  }

  async function list(context: AuthenticatedContext) {
    await authorizeRead(context);
    const forms = await options.database.marketingForm.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, name: true, publicSlug: true, status: true, revision: true, currentVersion: true, publishedAt: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 200,
    });
    if (!forms.length) return [];
    const [receipts, starts] = await Promise.all([
      options.database.marketingFormReceipt.groupBy({ by: ["marketingFormId"], where: { workspaceId: context.workspaceId, marketingFormId: { in: forms.map((form) => form.id) }, status: "ACCEPTED", deletedAt: null }, _count: { _all: true } }),
      options.database.$queryRaw<Array<{ marketingFormId: string; total: bigint }>>(Prisma.sql`SELECT "marketingFormId", COUNT(DISTINCT "sessionId")::bigint AS total FROM "marketing_form_events" WHERE "workspaceId"=${context.workspaceId}::uuid AND kind='FORM_START' AND "marketingFormId" = ANY(ARRAY[${Prisma.join(forms.map((form) => form.id))}]::uuid[]) GROUP BY "marketingFormId"`),
    ]);
    const acceptedByForm = new Map(receipts.map((row) => [row.marketingFormId, row._count._all]));
    const startsByForm = new Map(starts.map((row) => [row.marketingFormId, Number(row.total)]));
    return forms.map((form) => {
      const responseCount = acceptedByForm.get(form.id) ?? 0;
      const startCount = startsByForm.get(form.id) ?? 0;
      return { ...form, responseCount, completionRate: startCount ? Math.round(responseCount / startCount * 10_000) / 100 : null };
    });
  }

  async function detail(context: AuthenticatedContext, id: string) {
    await authorizeRead(context, id);
    const form = await options.database.marketingForm.findFirst({ where: { id, workspaceId: context.workspaceId, deletedAt: null } });
    if (!form) fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
    const parsed = marketingFormDefinitionSchema.safeParse(form.draftDefinition);
    return { ...form, definition: parsed.success ? parsed.data : null, definitionValid: parsed.success };
  }

  async function catalog(context: AuthenticatedContext) {
    await authorizeRead(context);
    const [sources, pipelines, queues, tags, connections] = await Promise.all([
      options.database.leadSource.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, key: true, name: true }, orderBy: { name: "asc" } }),
      options.database.pipeline.findMany({ where: { workspaceId: context.workspaceId, entityType: "LEAD", deletedAt: null }, select: { id: true, name: true, stages: { where: { deletedAt: null }, select: { id: true, name: true, position: true }, orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
      options.database.queue.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, key: true, name: true }, orderBy: { name: "asc" } }),
      options.database.tag.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" }, take: 200 }),
      options.database.integrationConnection.findMany({ where: { workspaceId: context.workspaceId, disabledAt: null }, select: { id: true, displayName: true, providerKey: true, status: true }, orderBy: { displayName: "asc" } }),
    ]);
    return { sources, pipelines, queues, tags, connections };
  }

  async function create(context: AuthenticatedContext, raw: unknown) {
    await authorizeManage(context);
    const input = createMarketingFormSchema.parse(raw);
    const existing = await options.database.marketingForm.findUnique({ where: { publicSlug: input.publicSlug } });
    if (existing) {
      if (existing.workspaceId === context.workspaceId && existing.name === input.name && existing.deletedAt === null) return existing;
      fail("Este endereço público não está disponível.", "MARKETING_FORM_SLUG_UNAVAILABLE", 409);
    }
    return options.database.$transaction(async (tx) => {
      const [source, pipeline, queue] = await Promise.all([
        tx.leadSource.findFirst({ where: { workspaceId: context.workspaceId, deletedAt: null }, orderBy: [{ type: "asc" }, { createdAt: "asc" }], select: { key: true } }),
        tx.pipeline.findFirst({ where: { workspaceId: context.workspaceId, entityType: "LEAD", deletedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true, stages: { where: { type: "OPEN", deletedAt: null }, orderBy: { position: "asc" }, take: 1, select: { id: true } } } }),
        tx.queue.findFirst({ where: { workspaceId: context.workspaceId, isGeneral: true, deletedAt: null }, select: { id: true } }),
      ]);
      const empty = createEmptyMarketingFormDefinition();
      const definition = {
        ...empty,
        questions: [...empty.questions, { stableKey: "telefone", type: "PHONE" as const, title: "Qual é o seu telefone?", required: true, position: 1, mapping: "phone" as const, config: { defaultCountry: "BR" } }],
        destination: { ...empty.destination, sourceKey: source?.key ?? empty.destination.sourceKey, pipelineId: pipeline?.id ?? empty.destination.pipelineId, initialStageId: pipeline?.stages[0]?.id ?? empty.destination.initialStageId, queueId: queue?.id ?? null },
      } satisfies MarketingFormDefinition;
      const form = await tx.marketingForm.create({
        data: {
          workspaceId: context.workspaceId,
          key: keyFromSlug(input.publicSlug),
          name: input.name,
          publicSlug: input.publicSlug,
          draftDefinition: json(definition),
          draftSchemaVersion: MARKETING_FORM_SCHEMA_VERSION,
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
        },
      });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.form.created", entityType: "MarketingForm", entityId: form.id, changes: { publicSlug: form.publicSlug, revision: form.revision } } });
      return form;
    });
  }

  async function updateDraft(context: AuthenticatedContext, id: string, raw: unknown) {
    await authorizeManage(context, id);
    const input = updateMarketingFormSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      const changed = await tx.marketingForm.updateMany({
        where: { id, workspaceId: context.workspaceId, deletedAt: null, archivedAt: null, revision: input.expectedRevision },
        data: { name: input.name, draftDefinition: json(input.definition), draftSchemaVersion: MARKETING_FORM_SCHEMA_VERSION, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: options.now() },
      });
      if (changed.count !== 1) fail("O formulário foi alterado por outra sessão.", "MARKETING_FORM_REVISION_CONFLICT", 409);
      const form = await tx.marketingForm.findFirstOrThrow({ where: { id, workspaceId: context.workspaceId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.form.draft_updated", entityType: "MarketingForm", entityId: id, changes: { revision: form.revision, questionCount: input.definition.questions.length } } });
      return form;
    });
  }

  async function assertPublishReferences(database: PrismaClient | Prisma.TransactionClient, context: AuthenticatedContext, definition: MarketingFormDefinition) {
    const mappings = new Set(definition.questions.flatMap((question) => question.mapping ? [question.mapping] : []));
    if (!mappings.has("fullName") || !mappings.has("phone")) {
      fail("Mapeie nome completo e telefone antes de publicar.", "MARKETING_FORM_REQUIRED_MAPPING_MISSING", 422);
    }
    const assetOrigins = marketingFormAssetOrigins(process.env.MARKETING_FORM_ASSET_ORIGINS);
    const assetUrls = [definition.style.logoUrl, definition.style.backgroundImageUrl].filter((value): value is string => Boolean(value));
    if (assetUrls.some((value) => !isAllowedMarketingFormAssetUrl(value, assetOrigins))) {
      fail("Logo ou fundo usa uma origin não autorizada.", "MARKETING_FORM_ASSET_ORIGIN_NOT_ALLOWED", 422);
    }
    const configuredProviders = [definition.tracking.meta, definition.tracking.google].filter((tracking): tracking is NonNullable<typeof tracking> => Boolean(tracking?.enabled && tracking.connectionId));
    const connectionIds = [...new Set(configuredProviders.flatMap((tracking) => tracking.connectionId ? [tracking.connectionId] : []))];
    const secretReferences = configuredProviders.flatMap((tracking) => tracking.connectionId && tracking.secretReferenceKey ? [{ connectionId: tracking.connectionId, referenceKey: tracking.secretReferenceKey }] : []);
    if (configuredProviders.some((tracking) => !tracking.secretReferenceKey)) {
      fail("A integração ativa precisa de uma referência de segredo vigente.", "MARKETING_FORM_SECRET_REFERENCE_REQUIRED", 422);
    }
    const [source, pipeline, stage, tags, queue, connections, secrets] = await Promise.all([
      database.leadSource.findFirst({ where: { workspaceId: context.workspaceId, key: definition.destination.sourceKey, deletedAt: null }, select: { id: true } }),
      database.pipeline.findFirst({ where: { workspaceId: context.workspaceId, id: definition.destination.pipelineId, entityType: "LEAD", deletedAt: null }, select: { id: true } }),
      database.pipelineStage.findFirst({ where: { workspaceId: context.workspaceId, id: definition.destination.initialStageId, pipelineId: definition.destination.pipelineId, deletedAt: null }, select: { id: true } }),
      database.tag.count({ where: { workspaceId: context.workspaceId, id: { in: definition.destination.tagIds }, deletedAt: null } }),
      definition.destination.queueId ? database.queue.findFirst({ where: { workspaceId: context.workspaceId, id: definition.destination.queueId, deletedAt: null }, select: { id: true } }) : Promise.resolve({ id: "none" }),
      database.integrationConnection.findMany({ where: { workspaceId: context.workspaceId, id: { in: connectionIds }, disabledAt: null, enabled: true }, select: { id: true } }),
      secretReferences.length ? database.integrationSecretReference.findMany({ where: { workspaceId: context.workspaceId, disabledAt: null, present: true, OR: secretReferences }, select: { connectionId: true, referenceKey: true } }) : Promise.resolve([]),
    ]);
    const foundSecrets = new Set(secrets.map((secret) => `${secret.connectionId}:${secret.referenceKey}`));
    const allSecretsPresent = secretReferences.every((secret) => foundSecrets.has(`${secret.connectionId}:${secret.referenceKey}`));
    if (!source || !pipeline || !stage || !queue || tags !== new Set(definition.destination.tagIds).size || connections.length !== connectionIds.length || !allSecretsPresent) {
      fail("O formulário referencia destino ou integração indisponível neste workspace.", "MARKETING_FORM_REFERENCE_NOT_FOUND", 422);
    }
  }

  async function publish(context: AuthenticatedContext, id: string, expectedRevision: number) {
    await authorizeManage(context, id);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-form:${context.workspaceId}:${id}`}, 0))`;
      const form = await tx.marketingForm.findFirst({ where: { id, workspaceId: context.workspaceId, deletedAt: null, archivedAt: null } });
      if (!form) fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
      if (form.revision !== expectedRevision) fail("O formulário foi alterado por outra sessão.", "MARKETING_FORM_REVISION_CONFLICT", 409);
      const definition = parseDefinition(form.draftDefinition);
      if (definition.tracking.meta?.enabled || definition.tracking.google?.enabled) {
        await options.authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_MANAGE, resource(context, id));
        await options.authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_SECRETS_MANAGE, resource(context, id));
      }
      await assertPublishReferences(tx, context, definition);
      const versionNumber = form.publishedVersionId ? form.currentVersion + 1 : 1;
      const publishedAt = options.now();
      const definitionHash = sha256(canonicalJson(definition));
      const version = await tx.marketingFormVersion.create({ data: { workspaceId: context.workspaceId, marketingFormId: form.id, version: versionNumber, schemaVersion: MARKETING_FORM_SCHEMA_VERSION, definition: json(definition), definitionHash, publishedAt, publishedByActorId: context.actorId, createdByActorId: context.actorId } });
      const updated = await tx.marketingForm.update({ where: { id: form.id }, data: { status: "ACTIVE", currentVersion: versionNumber, publishedVersionId: version.id, publishedAt, pausedAt: null, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: publishedAt } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.form.published", entityType: "MarketingForm", entityId: form.id, changes: { version: versionNumber, definitionHash, revision: updated.revision } } });
      return { form: updated, version: { id: version.id, publicId: version.publicId, version: version.version, definitionHash } };
    }, { isolationLevel: "Serializable" });
  }

  async function transition(context: AuthenticatedContext, id: string, action: "PAUSE" | "ACTIVATE" | "ARCHIVE", expectedRevision: number) {
    await authorizeManage(context, id);
    return options.database.$transaction(async (tx) => {
      const form = await tx.marketingForm.findFirst({ where: { id, workspaceId: context.workspaceId, deletedAt: null } });
      if (!form) fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
      if (form.revision !== expectedRevision) fail("O formulário foi alterado por outra sessão.", "MARKETING_FORM_REVISION_CONFLICT", 409);
      if (form.archivedAt || form.status === "ARCHIVED") fail("Formulário arquivado não aceita novas transições.", "MARKETING_FORM_ARCHIVED", 409);
      if (action === "ACTIVATE" && !form.publishedVersionId) fail("Publique uma versão antes de ativar.", "MARKETING_FORM_NOT_PUBLISHED", 422);
      const at = options.now();
      const data = action === "PAUSE"
        ? { status: "INACTIVE" as const, pausedAt: at, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at }
        : action === "ACTIVATE"
          ? { status: "ACTIVE" as const, pausedAt: null, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at }
          : { status: "ARCHIVED" as const, archivedAt: at, revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: at };
      const updated = await tx.marketingForm.update({ where: { id: form.id }, data });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `marketing.form.${action.toLowerCase()}`, entityType: "MarketingForm", entityId: id, changes: { previousStatus: form.status, status: updated.status, revision: updated.revision } } });
      return updated;
    });
  }

  async function duplicate(context: AuthenticatedContext, id: string, name: string, publicSlug: string) {
    await authorizeManage(context, id);
    marketingFormSlugSchema.parse(publicSlug);
    const source = await options.database.marketingForm.findFirst({ where: { id, workspaceId: context.workspaceId, deletedAt: null, archivedAt: null } });
    if (!source) fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
    return create(context, { name, publicSlug }).then(async (created) => options.database.marketingForm.update({ where: { id: created.id }, data: { draftDefinition: json(source.draftDefinition), draftSchemaVersion: source.draftSchemaVersion, updatedByActorId: context.actorId } }));
  }

  async function action(context: AuthenticatedContext, id: string, raw: unknown) {
    const input = marketingFormActionSchema.parse(raw);
    if (input.action === "PUBLISH") return publish(context, id, input.expectedRevision);
    if (input.action === "DUPLICATE") return duplicate(context, id, input.name, input.publicSlug);
    return transition(context, id, input.action, input.expectedRevision);
  }

  async function resolvePublic(rawSlug: string) {
    const slug = marketingFormSlugSchema.parse(rawSlug);
    const form = await options.database.marketingForm.findUnique({ where: { publicSlug: slug }, select: { id: true, workspaceId: true, name: true, status: true, archivedAt: true, deletedAt: true, publishedVersionId: true } });
    if (!form || form.status !== "ACTIVE" || form.archivedAt || form.deletedAt || !form.publishedVersionId) fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
    const version = await options.database.marketingFormVersion.findFirst({ where: { id: form.publishedVersionId, workspaceId: form.workspaceId, marketingFormId: form.id } });
    if (!version) fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
    const definition = parseDefinition(version.definition);
    return {
      slug,
      versionPublicId: version.publicId,
      title: definition.style.title ?? form.name,
      questions: definition.questions,
      thankYou: definition.thankYou,
      style: definition.style,
      tracking: {
        ...(definition.tracking.meta?.enabled && definition.tracking.meta.pixelId ? { meta: { pixelId: definition.tracking.meta.pixelId } } : {}),
        ...(definition.tracking.google?.enabled && definition.tracking.google.conversionId ? { google: { conversionId: definition.tracking.google.conversionId, conversionLabel: definition.tracking.google.conversionLabel } } : {}),
      },
    };
  }

  return Object.freeze({ list, detail, catalog, create, updateDraft, action, publish, transition, duplicate, resolvePublic });
}

let service: ReturnType<typeof createMarketingFormService> | undefined;
export function getMarketingFormService() {
  service ??= createMarketingFormService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
