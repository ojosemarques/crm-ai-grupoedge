import { createHmac } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAcquisitionWebhookService } from "./acquisition-webhook-service";
import { metaIdSchema, metaNativeConfigurationSchema, saoPauloDay } from "../domain/meta-native-contracts";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { META_ADS_DEFAULT_API_VERSION } from "@/modules/integrations/domain/meta-ads-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { assertMetaNativeTarget } from "./meta-native-target";

function fail(code: string, message: string, statusCode = 422): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
type Options = { database: PrismaClient; secrets: SecretResolver; fetcher: typeof fetch; now: () => Date; webhooks: Pick<ReturnType<typeof getAcquisitionWebhookService>, "receive"> };

export function createMetaNativeService(options: Options) {
  const authorization = getAuthorizationService();
  async function authorize(context: AuthenticatedContext, manage = false) {
    await authorization.assertAuthorized(context, manage ? PermissionKeys.INTEGRATIONS_EXECUTE : PermissionKeys.MARKETING_JOURNEY_READ, { workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: context.workspaceId });
  }
  async function list(context: AuthenticatedContext) {
    await authorize(context);
    const connections = await options.database.integrationConnection.findMany({ where: { workspaceId: context.workspaceId, providerKey: "META_LEAD_ADS" }, include: { configVersions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } });
    const { start, end } = saoPauloDay(options.now());
    return Promise.all(connections.flatMap((connection) => {
      const config = connection.configVersions[0]?.config as Record<string, unknown> | undefined;
      const parsed = metaNativeConfigurationSchema.safeParse(config?.metaNative);
      if (!parsed.success) return [];
      const native = parsed.data;
      return [(async () => {
        const forms = await Promise.all(native.forms.map(async (form) => {
          const where = { workspaceId: context.workspaceId, channel: "AD" as const, formIdentifier: `meta-native:${form.id}`, rawPayload: { path: ["pageId"], equals: native.pageId } };
          const [total, today] = await Promise.all([options.database.leadFormSubmission.count({ where }), options.database.leadFormSubmission.count({ where: { ...where, submittedAt: { gte: start, lt: end } } })]);
          return { ...form, total, today };
        }));
        const [processed, pending, failed, lastReceived, feedback] = await Promise.all([
          options.database.webhookInbox.count({ where: { workspaceId: context.workspaceId, connectionId: connection.id, status: "PROCESSED" } }),
          options.database.webhookInbox.count({ where: { workspaceId: context.workspaceId, connectionId: connection.id, status: { in: ["RECEIVED", "VERIFIED", "PROCESSING", "RETRY_PENDING"] } } }),
          options.database.webhookInbox.count({ where: { workspaceId: context.workspaceId, connectionId: connection.id, status: "DEAD_LETTER" } }),
          options.database.webhookInbox.findFirst({ where: { workspaceId: context.workspaceId, connectionId: connection.id, status: "PROCESSED" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
          options.database.outboxEvent.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId, connectionId: connection.id, eventType: "meta.native.lifecycle" }, _count: true }),
        ]);
        return { id: connection.id, name: connection.displayName, enabled: connection.enabled, status: connection.status, pageId: native.pageId, forms, processed, pending, failed, lastReceivedAt: lastReceived?.receivedAt.toISOString() ?? null, feedback: feedback.map((row) => ({ status: row.status, count: row._count })), importFrom: native.importFrom };
      })()];
    }));
  }

  async function graph(path: string, token: string, parameters: Record<string, string>, appSecret: string) {
    const url = new URL(`https://graph.facebook.com/${META_ADS_DEFAULT_API_VERSION}/${path}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    url.searchParams.set("appsecret_proof", createHmac("sha256", appSecret).update(token).digest("hex"));
    const response = await options.fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "error" });
    const text = await response.text();
    if (!response.ok || text.length > 512 * 1024) fail("META_NATIVE_READ_FAILED", "A Meta não permitiu consultar os formulários. Confira acesso à Página e a leads.", 502);
    try { return JSON.parse(text) as Record<string, unknown>; } catch { fail("META_NATIVE_READ_FAILED", "Resposta Meta inválida.", 502); }
  }
  async function graphList(path: string, token: string, parameters: Record<string, string>, appSecret: string) {
    const rows: Record<string, unknown>[] = [];
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = await graph(path, token, { ...parameters, limit: "100", ...(after ? { after } : {}) }, appSecret);
      if (!Array.isArray(result.data)) fail("META_NATIVE_READ_FAILED", "Lista de formulários ou leads inválida.", 502);
      rows.push(...result.data as Record<string, unknown>[]);
      const paging = result.paging as { next?: string; cursors?: { after?: string } } | undefined;
      if (!paging?.next) return rows;
      if (!paging.cursors?.after || paging.cursors.after === after) fail("META_NATIVE_PAGINATION_INVALID", "Cursor de paginação Meta inválido.", 502);
      after = paging.cursors.after;
    }
    fail("META_NATIVE_PAGE_LIMIT", "A consulta excedeu o limite de páginas. Nenhum histórico adicional será importado.", 502);
  }
  async function sync(context: AuthenticatedContext, connectionId: string, importToday: boolean) {
    await authorize(context, true);
    await authorization.assertAuthorized(context, PermissionKeys.INTEGRATIONS_MANAGE, { workspaceId: context.workspaceId, resourceType: "IntegrationConnection", resourceId: connectionId });
    const connection = await options.database.integrationConnection.findFirst({ where: { id: connectionId, workspaceId: context.workspaceId, providerKey: "META_LEAD_ADS", enabled: true, status: { in: ["ACTIVE_LOCAL", "CONNECTED"] } }, include: { configVersions: { orderBy: { version: "desc" }, take: 1 }, secrets: { where: { present: true, disabledAt: null }, orderBy: { version: "desc" } } } });
    if (!connection) fail("META_NATIVE_CONNECTION_NOT_READY", "Conexão nativa não está ativa.", 409);
    const current = connection.configVersions[0]!;
    const config = current.config as Record<string, unknown>;
    const native = metaNativeConfigurationSchema.parse(config.metaNative);
    await assertMetaNativeTarget(options.secrets, context.workspaceId, native);
    const ref = connection.secrets.find((item) => item.alias === "lead-enrichment-token");
    const token = ref ? await options.secrets.resolve(ref.referenceKey) : null;
    const signingRef = connection.secrets.find((item) => item.alias === "webhook-hmac");
    const signingSecret = signingRef ? await options.secrets.resolve(signingRef.referenceKey) : null;
    if (!token || !signingSecret) fail("META_NATIVE_CREDENTIAL_UNAVAILABLE", "Credencial nativa indisponível.", 503);
    const page = await graph(native.pageId, token, { fields: "id" }, signingSecret);
    if (String(page.id) !== native.pageId) fail("META_NATIVE_PAGE_MISMATCH", "Página retornada difere da conexão.");
    const forms = (await graphList(`${native.pageId}/leadgen_forms`, token, { fields: "id,name,status,page_id" }, signingSecret)).map((form) => {
      if (String(form.page_id) !== native.pageId) fail("META_NATIVE_FORM_MISMATCH", "Formulário pertence a outra Página.");
      return { id: metaIdSchema.parse(String(form.id)), name: String(form.name).slice(0, 200), status: String(form.status).slice(0, 40) };
    });
    if (forms.length > 500) fail("META_NATIVE_FORM_LIMIT", "A Página excede o limite de formulários desta conexão.");
    await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`meta-native:${connection.id}`}, 0))`;
      const latest = await tx.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } });
      if (!latest.enabled || latest.revision !== connection.revision) fail("META_NATIVE_REVISION_CONFLICT", "A conexão mudou durante a consulta.", 409);
      const next = { ...config, metaNative: { ...native, forms } };
      const hash = sha256(canonicalJson(next));
      if (hash !== current.configHash) {
        await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: context.workspaceId, connectionId: connection.id, version: current.version + 1, schemaVersion: current.schemaVersion, config: next as Prisma.InputJsonValue, configHash: hash, createdByActorId: context.actorId } });
        await tx.integrationConnection.update({ where: { id: connection.id }, data: { currentConfigVersion: current.version + 1, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      }
    });
    const { start, end } = saoPauloDay(options.now());
    const floor = new Date(Math.max(start.getTime(), new Date(native.importFrom).getTime()));
    let processed = 0;
    let replayed = 0;
    if (importToday && floor < end) for (const form of forms) {
      const leads = await graphList(`${form.id}/leads`, token, { fields: "id,created_time,form_id", filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: Math.floor(floor.getTime() / 1000) - 1 }, { field: "time_created", operator: "LESS_THAN", value: Math.floor(end.getTime() / 1000) }]) }, signingSecret);
      for (const lead of leads) {
        const at = new Date(String(lead.created_time));
        if (!Number.isFinite(at.getTime()) || at < floor || at >= end) continue;
        if (String(lead.form_id) !== form.id) fail("META_NATIVE_LEAD_MISMATCH", "Lead retornado pertence a outro formulário.");
        const id = metaIdSchema.parse(String(lead.id));
        const rawBody = canonicalJson({ object: "page", entry: [{ id: native.pageId, changes: [{ field: "leadgen", value: { page_id: native.pageId, form_id: form.id, leadgen_id: id, created_time: Math.floor(at.getTime() / 1000) } }] }] });
        const result = await options.webhooks.receive({ workspaceSlug: context.workspaceSlug, connectionKey: connection.key, rawBody, headers: { signature: `sha256=${createHmac("sha256", signingSecret).update(rawBody).digest("hex")}` } });
        if (result.status === "PROCESSED" || result.status === "IGNORED") { if (result.idempotentReplay) replayed++; else processed++; }
      }
    }
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "acquisition.meta_native.synchronized", entityType: "IntegrationConnection", entityId: connection.id, changes: { forms: forms.length, processed, replayed, importToday, start: floor.toISOString(), end: end.toISOString() } } });
    return { forms: forms.length, processed, replayed, start: floor.toISOString(), end: end.toISOString() };
  }
  return Object.freeze({ list, sync });
}
let singleton: ReturnType<typeof createMetaNativeService> | undefined;
export function getMetaNativeService() { singleton ??= createMetaNativeService({ database: getDatabaseClient(), secrets: environmentSecretResolver, fetcher: fetch, now: () => new Date(), webhooks: getAcquisitionWebhookService() }); return singleton; }
