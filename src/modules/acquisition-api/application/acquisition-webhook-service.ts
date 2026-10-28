import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getLeadIntakeService, type LeadIntakeInput } from "@/modules/leads/application/lead-intake-service";
import { resolveServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { environmentSecretResolver, type SecretResolver } from "@/modules/integrations/application/secret-resolver";
import { createOutboxEventInTransaction } from "@/modules/integrations/application/integration-platform-service";
import { ACQUISITION_MAX_WEBHOOK_BYTES } from "@/modules/acquisition-api/domain/acquisition-contracts";
import { canonicalJson, redactSensitive, sha256 } from "@/modules/integrations/domain/integration-policy";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { META_ADS_DEFAULT_API_VERSION } from "@/modules/integrations/domain/meta-ads-contracts";
import { metaNativeConfigurationSchema } from "@/modules/acquisition-api/domain/meta-native-contracts";
import { assertMetaNativeTarget } from "./meta-native-target";
import { isMetaNativeTestLead, metaNativeAnswers } from "../domain/meta-native-answers";

type Options = Readonly<{ database: PrismaClient; secrets: SecretResolver; now: () => Date; intake: ReturnType<typeof getLeadIntakeService>; fetcher: typeof fetch }>;
type Headers = Readonly<{ signature?: string; timestamp?: string }>;
function fail(message: string, code: string, statusCode: number): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(redactSensitive(value))) as Prisma.InputJsonValue; }
function equal(expected: string, supplied: string): boolean { const a = Buffer.from(expected); const b = Buffer.from(supplied); return a.length === b.length && timingSafeEqual(a, b); }
function path(value: unknown, key: string): unknown { return key.split(".").reduce<unknown>((current, part) => current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined, value); }
function fieldsFromProvider(provider: string, body: Record<string, unknown>): Record<string, unknown> {
  if (provider === "META_LEAD_ADS") { const entry = Array.isArray(body.entry) ? body.entry[0] as Record<string, unknown> | undefined : undefined; const change = Array.isArray(entry?.changes) ? entry.changes[0] as Record<string, unknown> | undefined : undefined; const value = change?.value as Record<string, unknown> | undefined; const pairs = Array.isArray(value?.field_data) ? value.field_data : []; return { ...value, fields: Object.fromEntries(pairs.flatMap((item) => { const row = item as Record<string, unknown>; return typeof row.name === "string" ? [[row.name, Array.isArray(row.values) ? row.values[0] : undefined]] : []; })) }; }
  if (provider === "TYPEFORM") { const response = body.form_response as Record<string, unknown> | undefined; const answers = Array.isArray(response?.answers) ? response.answers : []; const fields = Object.fromEntries(answers.flatMap((item) => { const answer = item as Record<string, unknown>; const field = answer.field as Record<string, unknown> | undefined; const key = typeof field?.ref === "string" ? field.ref : typeof field?.id === "string" ? field.id : null; const value = answer.text ?? answer.email ?? answer.phone_number ?? answer.number ?? answer.boolean ?? (answer.choice as Record<string, unknown> | undefined)?.label; return key ? [[key, value]] : []; })); return { ...response, fields }; }
  return body;
}
function eventInfo(provider: string, body: Record<string, unknown>, now: Date) {
  if (provider === "META_LEAD_ADS") { const entry = Array.isArray(body.entry) ? body.entry[0] as Record<string, unknown> | undefined : undefined; const change = Array.isArray(entry?.changes) ? entry.changes[0] as Record<string, unknown> | undefined : undefined; const value = change?.value as Record<string, unknown> | undefined; const id = String(value?.leadgen_id ?? ""); const seconds = Number(value?.created_time ?? entry?.time); return { id, externalId: id, occurredAt: Number.isFinite(seconds) ? new Date(seconds * 1000) : now }; }
  if (provider === "TYPEFORM") { const response = body.form_response as Record<string, unknown> | undefined; const id = String(body.event_id ?? response?.token ?? ""); const occurredAt = new Date(String(body.event_at ?? response?.submitted_at ?? now.toISOString())); return { id, externalId: String(response?.token ?? id), occurredAt }; }
  const id = String(body.eventId ?? body.submissionId ?? ""); const occurredAt = new Date(String(body.occurredAt ?? body.submittedAt ?? now.toISOString())); return { id, externalId: String(body.submissionId ?? id), occurredAt };
}
function verify(provider: string, secret: string, rawBody: string, headers: Headers, now: Date) {
  const supplied = headers.signature ?? "";
  if (provider === "META_LEAD_ADS") return equal(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`, supplied);
  if (provider === "TYPEFORM") return equal(`sha256=${createHmac("sha256", secret).update(rawBody).digest("base64")}`, supplied);
  const timestamp = headers.timestamp ? new Date(headers.timestamp) : null; if (!timestamp || Number.isNaN(timestamp.getTime()) || Math.abs(now.getTime() - timestamp.getTime()) > 300_000) return false;
  return equal(createHmac("sha256", secret).update(`${headers.timestamp}.${rawBody}`).digest("hex"), supplied.replace(/^sha256=/, ""));
}
function strictConsent(value: unknown): boolean | undefined { if (value === true || value === "true" || value === "1" || value === "yes" || value === "sim") return true; if (value === false || value === "false" || value === "0" || value === "no" || value === "nao" || value === "não") return false; return undefined; }

export function createAcquisitionWebhookService(options: Options) {
  async function verifyMetaChallenge(input: Readonly<{ workspaceSlug: string; connectionKey: string; mode: string; token: string; challenge: string }>) { if (input.mode !== "subscribe" || !/^\d{1,200}$/.test(input.challenge)) fail("Challenge Meta inválido.", "META_CHALLENGE_INVALID", 403); const connection = await options.database.integrationConnection.findFirst({ where: { key: input.connectionKey, workspace: { slug: input.workspaceSlug }, providerKey: "META_LEAD_ADS", enabled: true }, include: { secrets: { where: { alias: "webhook-verify-token", present: true, disabledAt: null }, orderBy: { version: "desc" }, take: 1 } } }); const reference = connection?.secrets[0]; const secret = reference ? await options.secrets.resolve(reference.referenceKey) : null; if (!secret || !equal(secret, input.token)) fail("Token de verificação Meta inválido.", "META_CHALLENGE_INVALID", 403); return input.challenge; }
  async function receive(input: Readonly<{ workspaceSlug: string; connectionKey: string; rawBody: string; headers: Headers; normalizedMeta?: boolean }>): Promise<Record<string, unknown>> {
    if (Buffer.byteLength(input.rawBody, "utf8") > ACQUISITION_MAX_WEBHOOK_BYTES) fail("Webhook excede 256 KiB.", "ACQUISITION_WEBHOOK_TOO_LARGE", 413);
    const connection = await options.database.integrationConnection.findFirst({ where: { key: input.connectionKey, workspace: { slug: input.workspaceSlug }, providerKey: { in: ["FORM", "LANDING_PAGE", "META_LEAD_ADS", "TYPEFORM"] }, enabled: true, status: { in: ["ACTIVE_LOCAL", "CONNECTED"] } }, include: { workspace: { select: { id: true } }, secrets: { where: { present: true, disabledAt: null }, orderBy: { version: "desc" } }, fieldMappings: { where: { objectType: "lead", active: true }, orderBy: { version: "desc" }, take: 1 } } });
    const signingReference = connection?.secrets.find((item) => item.alias === "webhook-hmac");
    if (!connection || !signingReference || !connection.fieldMappings[0]) fail("Webhook não disponível.", "ACQUISITION_WEBHOOK_NOT_FOUND", 404);
    const secret = await options.secrets.resolve(signingReference.referenceKey); if (!secret) fail("Referência de segredo indisponível.", "ACQUISITION_SECRET_UNAVAILABLE", 503);
    let body: Record<string, unknown>; try { body = JSON.parse(input.rawBody) as Record<string, unknown>; } catch { fail("JSON inválido.", "ACQUISITION_PAYLOAD_INVALID", 400); }
    if (!verify(connection.providerKey, secret, input.rawBody, input.headers, options.now())) fail("Assinatura inválida ou expirada.", "ACQUISITION_SIGNATURE_INVALID", 401);
    const config = await options.database.integrationConnectionConfigVersion.findFirst({ where: { workspaceId: connection.workspace.id, connectionId: connection.id }, orderBy: { version: "desc" } });
    const configValue = config?.config as Record<string, unknown> | null;
    const native = configValue?.metaNative ? metaNativeConfigurationSchema.parse(configValue.metaNative) : null;
    if (native) await assertMetaNativeTarget(options.secrets, connection.workspace.id, native);
    if (connection.providerKey === "META_LEAD_ADS" && !input.normalizedMeta) {
      const entries = Array.isArray(body.entry) ? body.entry.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")) : [];
      const units = entries.flatMap((entry) => (Array.isArray(entry.changes) ? entry.changes : []).map((change) => ({ ...body, entry: [{ ...entry, changes: [change] }] })));
      if (units.length === 0) fail("Lote Meta sem eventos leadgen válidos.", "META_BATCH_EMPTY", 422);
      const results = [];
      for (const unit of units) { const rawBody = canonicalJson(unit); const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`; results.push(await receive({ ...input, rawBody, headers: { signature }, normalizedMeta: true })); }
      return results.length === 1 ? results[0]! : { status: "BATCH_PROCESSED" as const, processed: results.length, results };
    }
    const info = eventInfo(connection.providerKey, body, options.now()); if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(info.id) || Number.isNaN(info.occurredAt.getTime())) fail("Identificador ou data do evento inválido.", "ACQUISITION_EVENT_INVALID", 422);
    const entry = Array.isArray(body.entry) ? body.entry[0] as Record<string, unknown> : undefined;
    const change = Array.isArray(entry?.changes) ? entry.changes[0] as Record<string, unknown> : undefined;
    const nativeValue = change?.value as Record<string, unknown> | undefined;
    if (native) {
      if (body.object !== "page" || String(entry?.id) !== native.pageId || change?.field !== "leadgen" || String(nativeValue?.page_id) !== native.pageId || !/^\d{3,40}$/.test(String(nativeValue?.form_id)) || !/^\d{3,40}$/.test(info.id)) fail("Evento não pertence à Página configurada.", "META_NATIVE_TARGET_MISMATCH", 422);
      if (info.occurredAt < new Date(native.importFrom)) return { status: "IGNORED", reason: "BEFORE_IMPORT_WINDOW" };
      if (info.occurredAt.getTime() > options.now().getTime() + 300_000) fail("Data futura inválida.", "META_NATIVE_EVENT_TIME_INVALID", 422);
    }
    // Importação inicial e webhook compartilham a identidade, mesmo com envelopes diferentes.
    const persistedBody = native ? { object: "page", pageId: native.pageId, formId: nativeValue!.form_id, leadId: info.id, createdTime: info.occurredAt.toISOString() } : body;
    const payloadHash = sha256(native ? canonicalJson(persistedBody) : input.rawBody); const nonceHash = sha256(`${connection.id}:${info.id}`); const safeBody = json(persistedBody);
    const inbox = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`acquisition-inbox:${connection.workspace.id}:${connection.id}:${info.id}`}, 0))`;
      const prior = await tx.webhookInbox.findUnique({ where: { workspaceId_connectionId_providerEventId: { workspaceId: connection.workspace.id, connectionId: connection.id, providerEventId: info.id } } });
      if (prior) { if (prior.payloadHash !== payloadHash) fail("Evento repetido com conteúdo divergente.", "ACQUISITION_IDEMPOTENCY_CONFLICT", 409); return { row: prior, replay: true }; }
      const row = await tx.webhookInbox.create({ data: { workspaceId: connection.workspace.id, connectionId: connection.id, providerEventId: info.id, eventType: "lead.received", contractVersion: "1.0", payloadHash, nonceHash, payloadSizeBytes: Buffer.byteLength(input.rawBody, "utf8"), payload: safeBody, dataClass: "CONTACT_DATA", signatureStatus: "VERIFIED", externalOccurredAt: info.occurredAt, receivedAt: options.now(), status: "VERIFIED", attempts: 0, correlationId: info.id } }); return { row, replay: false };
    });
    if (inbox.replay && ["PROCESSED", "IGNORED"].includes(inbox.row.status)) return { inboxId: inbox.row.id, status: inbox.row.status, idempotentReplay: true };
    const currentMapping = await options.database.externalObjectMapping.findUnique({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: connection.workspace.id, connectionId: connection.id, externalObjectType: "lead", externalId: info.externalId } } });
    if (currentMapping?.externalVersion && currentMapping.externalVersion >= info.occurredAt.toISOString()) { await options.database.webhookInbox.update({ where: { id: inbox.row.id }, data: { status: "IGNORED", attempts: { increment: 1 }, processedAt: options.now(), errorCode: "OUT_OF_ORDER", errorMessage: "Evento anterior ao cursor do objeto externo." } }); return { inboxId: inbox.row.id, status: "IGNORED" as const, idempotentReplay: inbox.replay, reason: "OUT_OF_ORDER" as const }; }
    let providerFields = fieldsFromProvider(connection.providerKey, body);
    let nativeForm: { name?: unknown; questions?: unknown; status?: unknown } | undefined;
    const embeddedFields = path(providerFields, "fields");
    if (connection.providerKey === "META_LEAD_ADS" && (native || !embeddedFields || typeof embeddedFields !== "object" || Object.keys(embeddedFields).length === 0)) {
      const tokenReference = connection.secrets.find((item) => item.alias === "lead-enrichment-token");
      const accessToken = tokenReference ? await options.secrets.resolve(tokenReference.referenceKey) : null;
      if (!accessToken) fail("Credencial Meta para enriquecimento indisponível.", "META_LEAD_ENRICHMENT_UNAVAILABLE", 503);
      const fields = native ? "id,created_time,field_data,form_id,ad_id,campaign_id" : "id,created_time,field_data";
      const proof = native ? `&appsecret_proof=${createHmac("sha256", secret).update(accessToken).digest("hex")}` : "";
      const response = await options.fetcher(`https://graph.facebook.com/${META_ADS_DEFAULT_API_VERSION}/${encodeURIComponent(info.externalId)}?fields=${fields}${proof}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
      const text = await response.text();
      if (!response.ok || text.length > 256 * 1024) fail("Falha transitória no enriquecimento Meta.", "META_LEAD_ENRICHMENT_FAILED", response.status === 429 ? 429 : 503);
      let enriched: Record<string, unknown>;
      try { enriched = JSON.parse(text) as Record<string, unknown>; } catch { fail("Resposta Meta inválida.", "META_LEAD_ENRICHMENT_FAILED", 503); }
      if (native) {
        if (String(enriched.id) !== info.id || String(enriched.form_id) !== String(nativeValue!.form_id) || new Date(String(enriched.created_time)).getTime() !== info.occurredAt.getTime()) fail("Identidade do lead difere do evento.", "META_NATIVE_LEAD_MISMATCH", 422);
        const form = await options.fetcher(`https://graph.facebook.com/${META_ADS_DEFAULT_API_VERSION}/${encodeURIComponent(String(enriched.form_id))}?fields=id,page_id,name,status,questions${proof}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
        const formBody = await form.json().catch(() => null) as { id?: string; page_id?: string; name?: unknown; status?: unknown; questions?: unknown } | null;
        if (!form.ok || String(formBody?.id) !== String(enriched.form_id) || String(formBody?.page_id) !== native.pageId) fail("Formulário não validado para a Página configurada.", "META_NATIVE_FORM_MISMATCH", 422);
        nativeForm = formBody!;
      }
      providerFields = fieldsFromProvider("META_LEAD_ADS", { entry: [{ changes: [{ value: enriched }] }] });
    }
    const mapping = connection.fieldMappings[0].mapping as Record<string, string>; const mapped = Object.fromEntries(Object.entries(mapping).map(([canonical, external]) => [canonical, path(providerFields, external)]));
    if (native && nativeForm) {
      const fields = providerFields.fields as Record<string, unknown>;
      const questions = Array.isArray(nativeForm.questions) ? nativeForm.questions as { type?: string; key?: string }[] : [];
      const phoneKey = questions.find((question) => question.type === "PHONE")?.key;
      if (isMetaNativeTestLead(fields, phoneKey)) {
        await options.database.webhookInbox.update({ where: { id: inbox.row.id }, data: { status: "IGNORED", attempts: { increment: 1 }, processedAt: options.now(), errorClass: null, errorCode: "META_NATIVE_TEST_LEAD", errorMessage: "Entrada sintética da ferramenta de testes Meta; excluída dos leads e métricas." } });
        return { inboxId: inbox.row.id, status: "IGNORED" as const, idempotentReplay: inbox.replay, reason: "META_NATIVE_TEST_LEAD" as const };
      }
      if (!mapped.phone && phoneKey) mapped.phone = fields[phoneKey];
      for (const [canonical, key] of Object.entries(native.fieldMapping)) if (key && fields[key] !== undefined) mapped[canonical] = fields[key];
    }
    const sourceKey = String(configValue?.sourceKey ?? "");
    const actor = await options.database.actor.findFirst({ where: { workspaceId: connection.workspace.id, type: "SYSTEM" }, orderBy: { createdAt: "asc" } }); if (!actor) fail("Ator de sistema ausente.", "ACQUISITION_SYSTEM_ACTOR_MISSING", 503);
    const context = await resolveServiceActorContext(connection.workspace.id, actor.id, "SYSTEM", options.database);
    const consent = strictConsent(mapped.consent); const acquisition = { ...(mapped.sessionPublicId ? { sessionPublicId: String(mapped.sessionPublicId) } : {}), ...(connection.providerKey === "FORM" || connection.providerKey === "LANDING_PAGE" ? { marketingFormKey: `${connection.key}-form`, marketingFormVersion: 1 } : {}), ...(connection.providerKey === "LANDING_PAGE" ? { landingPageKey: connection.key } : {}), ...(mapped.landingUrl ? { landingUrl: String(mapped.landingUrl) } : {}), ...(mapped.referrerUrl ? { referrerUrl: String(mapped.referrerUrl) } : {}), ...(mapped.utmSource ? { utmSource: String(mapped.utmSource) } : {}), ...(mapped.utmMedium ? { utmMedium: String(mapped.utmMedium) } : {}), ...(mapped.utmCampaign ? { utmCampaign: String(mapped.utmCampaign) } : {}), ...(mapped.utmContent ? { utmContent: String(mapped.utmContent) } : {}), ...(mapped.utmTerm ? { utmTerm: String(mapped.utmTerm) } : {}), ...((mapped.fbclid || mapped.gclid) ? { clickIds: { ...(mapped.fbclid ? { fbclid: String(mapped.fbclid) } : {}), ...(mapped.gclid ? { gclid: String(mapped.gclid) } : {}) } } : {}) };
    const intake: LeadIntakeInput = { channel: connection.providerKey === "META_LEAD_ADS" ? "AD" : connection.providerKey === "LANDING_PAGE" ? "LANDING_PAGE" : "FORM", idempotencyKey: `acq:${connection.id}:external:${info.externalId}`, formIdentifier: native ? `meta-native:${nativeValue!.form_id}` : connection.key, ...(native ? { pipelineId: native.pipelineId, initialStageId: native.initialStageId } : {}), fullName: String(mapped.fullName ?? ""), phone: String(mapped.phone ?? ""), ...(mapped.email ? { email: String(mapped.email) } : {}), ...(mapped.jobTitle ? { jobTitle: String(mapped.jobTitle) } : {}), ...(mapped.organizationName ? { organizationName: String(mapped.organizationName) } : {}), ...(mapped.city ? { city: String(mapped.city) } : {}), ...(mapped.stateCode ? { stateCode: String(mapped.stateCode) } : {}), ...(mapped.interestSummary ? { interestSummary: String(mapped.interestSummary) } : {}), ...(mapped.budgetCents !== undefined ? { budgetCents: Number(mapped.budgetCents) } : {}), ...(consent !== undefined ? { consent } : {}), sourceKey, ...(mapped.campaignExternalRef ? { campaignExternalRef: String(mapped.campaignExternalRef) } : {}), ...(mapped.creativeExternalRef ? { creativeExternalRef: String(mapped.creativeExternalRef) } : {}), submittedAt: info.occurredAt, rawPayload: { provider: connection.providerKey, eventId: info.id, payloadHash, ...(native ? { pageId: native.pageId, formId: String(nativeValue!.form_id), nativeResponse: metaNativeAnswers(nativeForm ?? {}, providerFields.fields as Record<string, unknown>, connection.displayName), ...(providerFields.ad_id ? { adId: String(providerFields.ad_id) } : {}), ...(providerFields.campaign_id ? { campaignId: String(providerFields.campaign_id) } : {}) } : {}) }, priorityBandCode: "P3", ...(Object.keys(acquisition).length ? { acquisition } : {}) };
    const result = await options.intake.intake(intake, context);
    if (result.outcome === "REJECTED") { await options.database.$transaction(async (tx) => { await tx.webhookInbox.update({ where: { id: inbox.row.id }, data: { status: "DEAD_LETTER", attempts: { increment: 1 }, errorClass: "INVALID_PAYLOAD", errorCode: result.code, errorMessage: result.issues.map((issue) => issue.message).join(" ") } }); await tx.integrationDeliveryAttempt.create({ data: { workspaceId: connection.workspace.id, kind: "INBOX", inboxId: inbox.row.id, attemptNumber: inbox.row.attempts + 1, status: "DEAD_LETTERED", errorClass: "INVALID_PAYLOAD", errorCode: result.code, errorMessage: result.issues.map((issue) => issue.message).join(" "), startedAt: inbox.row.receivedAt, finishedAt: options.now() } }); }); fail("Entrada rejeitada pelo contrato canônico.", result.code, 422); }
    const completion = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`acquisition-object:${connection.workspace.id}:${connection.id}:${info.externalId}`}, 0))`;
      const newest = await tx.externalObjectMapping.findUnique({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: connection.workspace.id, connectionId: connection.id, externalObjectType: "lead", externalId: info.externalId } } });
      if (newest?.externalVersion && newest.externalVersion >= info.occurredAt.toISOString()) { await tx.webhookInbox.update({ where: { id: inbox.row.id }, data: { status: "IGNORED", attempts: { increment: 1 }, processedAt: options.now(), errorCode: "OUT_OF_ORDER", errorMessage: "Evento anterior ou igual à versão externa vigente." } }); await tx.integrationDeliveryAttempt.create({ data: { workspaceId: connection.workspace.id, kind: "INBOX", inboxId: inbox.row.id, attemptNumber: inbox.row.attempts + 1, status: "SUCCEEDED", startedAt: inbox.row.receivedAt, finishedAt: options.now(), resultMetadata: json({ outcome: "IGNORED", reason: "OUT_OF_ORDER" }) } }); return "IGNORED" as const; }
      await tx.externalObjectMapping.upsert({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: connection.workspace.id, connectionId: connection.id, externalObjectType: "lead", externalId: info.externalId } }, create: { workspaceId: connection.workspace.id, connectionId: connection.id, externalObjectType: "lead", externalId: info.externalId, internalEntityType: "LEAD", internalEntityId: result.leadId, externalVersion: info.occurredAt.toISOString(), externalHash: payloadHash, firstRecognizedAt: options.now(), lastRecognizedAt: options.now(), createdByActorId: actor.id, updatedByActorId: actor.id }, update: { internalEntityId: result.leadId, externalVersion: info.occurredAt.toISOString(), externalHash: payloadHash, version: { increment: 1 }, lastRecognizedAt: options.now(), updatedByActorId: actor.id } });
      await tx.webhookInbox.update({ where: { id: inbox.row.id }, data: { status: "PROCESSED", attempts: { increment: 1 }, processedAt: options.now(), mappingId: connection.fieldMappings[0]!.id } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`acquisition-cursor:${connection.workspace.id}:${connection.id}:lead`}, 0))`;
      const cursorKey = { workspaceId: connection.workspace.id, connectionId: connection.id, direction: "PULL" as const, objectType: "lead" };
      const nextCursor = `${info.occurredAt.toISOString()}:${info.id}`;
      const currentCursor = await tx.integrationSyncCursor.findUnique({ where: { workspaceId_connectionId_direction_objectType: cursorKey } });
      if (!currentCursor) await tx.integrationSyncCursor.create({ data: { ...cursorKey, cursor: nextCursor, watermark: info.occurredAt, updatedByActorId: actor.id } });
      else if (!currentCursor.watermark || currentCursor.watermark < info.occurredAt || (currentCursor.watermark.getTime() === info.occurredAt.getTime() && (currentCursor.cursor ?? "") < nextCursor)) await tx.integrationSyncCursor.update({ where: { id: currentCursor.id }, data: { cursor: nextCursor, watermark: info.occurredAt, version: { increment: 1 }, updatedByActorId: actor.id } });
      if (native && nativeForm && !native.forms.some((form) => form.id === String(nativeValue!.form_id))) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`meta-native:${connection.id}`}, 0))`;
        const latest = await tx.integrationConnectionConfigVersion.findFirstOrThrow({ where: { workspaceId: connection.workspace.id, connectionId: connection.id }, orderBy: { version: "desc" } });
        const value = latest.config as Record<string, unknown>;
        const latestNative = metaNativeConfigurationSchema.parse(value.metaNative);
        if (latestNative.pageId === native.pageId && latestNative.forms.length < 500 && !latestNative.forms.some((form) => form.id === String(nativeValue!.form_id))) {
          const next = { ...value, metaNative: { ...latestNative, forms: [...latestNative.forms, { id: String(nativeValue!.form_id), name: String(nativeForm.name || connection.displayName).slice(0, 200), status: String(nativeForm.status || "ACTIVE").slice(0, 40) }] } };
          await tx.integrationConnectionConfigVersion.create({ data: { workspaceId: connection.workspace.id, connectionId: connection.id, version: latest.version + 1, schemaVersion: latest.schemaVersion, config: json(next), configHash: sha256(canonicalJson(next)), createdByActorId: actor.id } });
          await tx.integrationConnection.update({ where: { id: connection.id }, data: { currentConfigVersion: latest.version + 1, revision: { increment: 1 }, updatedByActorId: actor.id } });
        }
      }
      const event = await createOutboxEventInTransaction(tx, { workspaceId: connection.workspace.id, connectionId: connection.id, actorId: actor.id, eventType: "acquisition.lead.received", aggregateType: "LEAD", aggregateId: result.leadId, correlationId: info.id, causationId: inbox.row.id, idempotencyKey: `acquisition:${connection.id}:${info.id}`, payload: { leadId: result.leadId, submissionId: result.submissionId, provider: connection.providerKey, externalEgress: false } });
      await tx.outboxEvent.update({ where: { id: event.id }, data: { status: "DELIVERED_LOCAL", deliveredLocallyAt: options.now() } });
      await tx.integrationDeliveryAttempt.create({ data: { workspaceId: connection.workspace.id, kind: "INBOX", inboxId: inbox.row.id, attemptNumber: inbox.row.attempts + 1, status: "SUCCEEDED", startedAt: inbox.row.receivedAt, finishedAt: options.now(), resultMetadata: json({ leadId: result.leadId, outcome: result.outcome }) } });
      return "PROCESSED" as const;
    });
    if (completion === "IGNORED") return { inboxId: inbox.row.id, status: "IGNORED" as const, idempotentReplay: inbox.replay, reason: "OUT_OF_ORDER" as const };
    return { inboxId: inbox.row.id, status: "PROCESSED" as const, leadId: result.leadId, submissionId: result.submissionId, outcome: result.outcome, idempotentReplay: inbox.replay || result.idempotentReplay };
  }
  return Object.freeze({ receive, verifyMetaChallenge });
}
let singleton: ReturnType<typeof createAcquisitionWebhookService> | undefined;
export function getAcquisitionWebhookService() { singleton ??= createAcquisitionWebhookService({ database: getDatabaseClient(), secrets: environmentSecretResolver, now: () => new Date(), intake: getLeadIntakeService(), fetcher: fetch }); return singleton; }
