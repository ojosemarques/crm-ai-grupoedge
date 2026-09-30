import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const entityType = z.enum(["CONTACT", "ACCOUNT", "LEAD", "OPPORTUNITY"]);
const resource = (workspaceId: string) => ({ workspaceId, resourceType: "CommercialPortability" });
const fail = (message: string, code = "INVALID_INPUT", statusCode = 400): never => { throw new ApplicationError(message, { code, statusCode, expose: true }); };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const csv = (value: unknown) => { const text = String(value ?? ""); const safe = /^[=+@-]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"','""')}"`; };

async function existingIds(db: PrismaClient | Prisma.TransactionClient, workspaceId: string, type: z.infer<typeof entityType>, ids: string[]) {
  const where = { workspaceId, id: { in: ids }, deletedAt: null };
  const rows = type === "CONTACT" ? await db.contact.findMany({ where, select: { id: true } })
    : type === "ACCOUNT" ? await db.account.findMany({ where, select: { id: true } })
      : type === "LEAD" ? await db.lead.findMany({ where, select: { id: true } })
        : await db.opportunity.findMany({ where, select: { id: true } });
  return rows.map((row) => row.id).sort();
}

export function createPortabilityService(options: { database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>; now: () => Date }) {
  const authorize = (context: AuthenticatedContext, permission: string) => options.authorization.assertAuthorized(context, permission as never, resource(context.workspaceId));
  async function screen(context: AuthenticatedContext) {
    await authorize(context, PermissionKeys.PORTABILITY_READ);
    const [fields, tags, operations, contacts, opportunities, tagUsage, fieldUsage, exportDecision, exportCapability, manageDecision, bulkCapability] = await Promise.all([
      options.database.customFieldDefinition.findMany({ where: { workspaceId: context.workspaceId, active: true }, orderBy: [{ entityType: "asc" }, { name: "asc" }] }),
      options.database.tag.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, orderBy: { name: "asc" } }),
      options.database.portabilityBulkOperation.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "desc" }, take: 20 }),
      options.database.contact.count({where:{workspaceId:context.workspaceId,deletedAt:null}}), options.database.opportunity.count({where:{workspaceId:context.workspaceId,deletedAt:null}}),
      options.database.commercialEntityTag.groupBy({by:["tagId"],where:{workspaceId:context.workspaceId},_count:true}), options.database.customFieldValue.groupBy({by:["definitionId"],where:{workspaceId:context.workspaceId},_count:true}),
      options.authorization.authorize(context,PermissionKeys.PORTABILITY_EXPORT as never,resource(context.workspaceId)),
      options.authorization.authorize(context,PermissionKeys.EXPORTS_EXECUTE as never,resource(context.workspaceId)),
      options.authorization.authorize(context,PermissionKeys.PORTABILITY_MANAGE as never,resource(context.workspaceId)),
      options.authorization.authorize(context,PermissionKeys.BULK_ACTIONS_EXECUTE as never,resource(context.workspaceId)),
    ]);
    return { generatedAt:options.now().toISOString(), counts:{contacts,opportunities,tags:tags.length,fields:fields.length}, permissions:{canExport:exportDecision.allowed&&exportCapability.allowed,canBulk:manageDecision.allowed&&bulkCapability.allowed,canConfigure:manageDecision.allowed}, fields:fields.map(f=>({...f,label:f.name,usageCount:fieldUsage.find(u=>u.definitionId===f.id)?._count??0})), tags:tags.map(t=>({...t,active:true,entityTypes:["CONTACT","ACCOUNT","LEAD","OPPORTUNITY"],usageCount:tagUsage.find(u=>u.tagId===t.id)?._count??0})), operations };
  }
  async function exportCsv(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.PORTABILITY_EXPORT);
    await authorize(context, PermissionKeys.EXPORTS_EXECUTE);
    const input = z.object({ kind: z.enum(["CONTACTS", "OPPORTUNITIES"]), ids: z.array(z.string().uuid()).max(5000).optional(), reason: z.string().trim().min(3).max(1000) }).strict().parse(raw);
    const ids = input.ids ? [...new Set(input.ids)] : undefined;
    let content: string;
    let count: number;
    if (input.kind === "CONTACTS") {
      const rows = await options.database.contact.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, ...(ids ? { id: { in: ids } } : {}) }, include: { points: { where: { deletedAt: null } }, accountRoles: true }, orderBy: { id: "asc" } });
      content = ["id;nome;email;telefone;contas", ...rows.map((row) => [row.id,row.preferredName,row.points.find(p=>p.type==="EMAIL")?.originalValue,row.points.find(p=>p.type==="PHONE")?.originalValue,row.accountRoles.map(r=>r.accountId).join("|")].map(csv).join(";"))].join("\n"); count = rows.length;
    } else {
      const rows = await options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { id: "asc" } });
      content = ["id;leadId;accountId;nome;status;valor;moeda", ...rows.map(row=>[row.id,row.leadId,row.accountId,row.name,row.status,row.amountCents,row.currency].map(csv).join(";"))].join("\n"); count=rows.length;
    }
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "portability.export.generated", entityType: "CommercialExport", entityId: context.workspaceId, reason: input.reason, changes: { kind: input.kind, count } } });
    return { fileName: `${input.kind.toLowerCase()}-${options.now().toISOString().slice(0,10)}.csv`, content, count };
  }
  async function createField(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.PORTABILITY_MANAGE);
    const input = z.object({ entityType, key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,79}$/), name: z.string().trim().min(2).max(120), dataType: z.enum(["TEXT","NUMBER","BOOLEAN","DATE","SELECT","MULTI_SELECT"]), options: z.array(z.string().trim().min(1).max(120)).max(100).optional(), required: z.boolean().default(false) }).strict().parse(raw);
    const data: Prisma.CustomFieldDefinitionUncheckedCreateInput = { workspaceId: context.workspaceId, entityType: input.entityType, key: input.key, name: input.name, dataType: input.dataType, required: input.required, createdByActorId: context.actorId, updatedByActorId: context.actorId };
    if (input.options) data.options = json(input.options);
    return options.database.customFieldDefinition.create({ data });
  }
  async function tag(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.PORTABILITY_MANAGE);
    const input = z.union([z.object({ action: z.literal("CREATE"), name: z.string().trim().min(1).max(80), color: z.string().trim().max(30).optional() }).strict(), z.object({ action: z.literal("ASSIGN"), tagId: z.string().uuid(), entityType, entityId: z.string().uuid() }).strict()]).parse(raw);
    if (input.action === "CREATE") return options.database.tag.create({ data: { workspaceId: context.workspaceId, name: input.name, color: input.color ?? null, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    if ((await existingIds(options.database, context.workspaceId, input.entityType, [input.entityId])).length !== 1) fail("Entidade não encontrada.", "NOT_FOUND", 404);
    return options.database.commercialEntityTag.upsert({ where: { workspaceId_tagId_entityType_entityId: { workspaceId: context.workspaceId, tagId: input.tagId, entityType: input.entityType, entityId: input.entityId } }, create: { workspaceId: context.workspaceId, tagId: input.tagId, entityType: input.entityType, entityId: input.entityId, createdByActorId: context.actorId }, update: {} });
  }
  const bulkSchema = z.object({ entityType, action: z.enum(["ADD_TAG","REMOVE_TAG","SET_CUSTOM_FIELD"]), entityIds: z.array(z.string().uuid()).min(1).max(1000), payload: z.record(z.string(), z.json()), reason: z.string().trim().min(3).max(1000) }).strict();
  async function previewBulk(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.PORTABILITY_MANAGE); await authorize(context, PermissionKeys.BULK_ACTIONS_EXECUTE); const input=bulkSchema.parse(raw); const ids=[...new Set(input.entityIds)].sort(); const found=await existingIds(options.database,context.workspaceId,input.entityType,ids); if(found.length!==ids.length) fail("Uma ou mais entidades não pertencem ao workspace.","NOT_FOUND",404);
    if(input.action==="ADD_TAG"||input.action==="REMOVE_TAG"){const tagId=z.string().uuid().parse(input.payload.tagId);if(!await options.database.tag.findFirst({where:{id:tagId,workspaceId:context.workspaceId,deletedAt:null}})) fail("Tag inválida.","NOT_FOUND",404);} else {const definitionId=z.string().uuid().parse(input.payload.definitionId);if(!await options.database.customFieldDefinition.findFirst({where:{id:definitionId,workspaceId:context.workspaceId,entityType:input.entityType,active:true}})) fail("Campo customizado inválido.","NOT_FOUND",404);}
    const fingerprint=createHash("sha256").update(JSON.stringify([context.workspaceId,input.entityType,input.action,ids,input.payload,input.reason])).digest("hex");
    const operation=await options.database.$transaction(async tx=>{const operation=await tx.portabilityBulkOperation.upsert({ where:{workspaceId_fingerprint:{workspaceId:context.workspaceId,fingerprint}}, create:{workspaceId:context.workspaceId,entityType:input.entityType,action:input.action,entityIds:ids,payload:json(input.payload),fingerprint,reason:input.reason,expectedCount:ids.length,previewExpiresAt:new Date(options.now().getTime()+15*60_000),createdByActorId:context.actorId}, update:{} });await tx.auditLog.create({data:{workspaceId:context.workspaceId,actorId:context.actorId,action:"portability.bulk.previewed",entityType:"PortabilityBulkOperation",entityId:operation.id,reason:input.reason,changes:{fingerprint,count:ids.length,action:input.action}}});return operation;}); return { operationId:operation.id,fingerprint,count:ids.length,expiresAt:operation.previewExpiresAt };
  }
  async function executeBulk(context: AuthenticatedContext, raw: unknown) {
    await authorize(context, PermissionKeys.PORTABILITY_MANAGE); await authorize(context, PermissionKeys.BULK_ACTIONS_EXECUTE); const input=z.object({operationId:z.string().uuid(),fingerprint:z.string().length(64),reason:z.string().trim().min(3).max(1000).optional(),confirmed:z.literal(true).optional()}).strict().parse(raw);
    return options.database.$transaction(async tx=>{ const found=await tx.portabilityBulkOperation.findFirst({where:{id:input.operationId,workspaceId:context.workspaceId}}); if(!found) throw new ApplicationError("Prévia inválida.",{code:"BULK_PREVIEW_INVALID",statusCode:409,expose:true}); const op=found; if(input.reason&&input.reason!==op.reason) fail("O motivo difere da prévia.","BULK_PREVIEW_INVALID",409); if(op.fingerprint!==input.fingerprint) fail("Prévia inválida.","BULK_PREVIEW_INVALID",409); if(op.status!=="PREVIEWED"||op.previewExpiresAt<=options.now()) fail("Prévia expirada ou já executada.","BULK_PREVIEW_STALE",409); const ids=z.array(z.string().uuid()).parse(op.entityIds); if((await existingIds(tx,context.workspaceId,op.entityType,ids)).length!==op.expectedCount) fail("A seleção mudou após a prévia.","BULK_SELECTION_CHANGED",409); const payload=z.record(z.string(),z.json()).parse(op.payload);
      for(const entityId of ids){ let before:unknown=null; let after:unknown=null; if(op.action==="ADD_TAG"||op.action==="REMOVE_TAG"){const tagId=z.string().uuid().parse(payload.tagId); const prior=await tx.commercialEntityTag.findUnique({where:{workspaceId_tagId_entityType_entityId:{workspaceId:context.workspaceId,tagId,entityType:op.entityType,entityId}}}); before={assigned:Boolean(prior),tagId}; if(op.action==="ADD_TAG") await tx.commercialEntityTag.upsert({where:{workspaceId_tagId_entityType_entityId:{workspaceId:context.workspaceId,tagId,entityType:op.entityType,entityId}},create:{workspaceId:context.workspaceId,tagId,entityType:op.entityType,entityId,createdByActorId:context.actorId},update:{}}); else await tx.commercialEntityTag.deleteMany({where:{workspaceId:context.workspaceId,tagId,entityType:op.entityType,entityId}}); after={assigned:op.action==="ADD_TAG",tagId};} else {const definitionId=z.string().uuid().parse(payload.definitionId); const definition=await tx.customFieldDefinition.findFirst({where:{id:definitionId,workspaceId:context.workspaceId,entityType:op.entityType,active:true}}); if(!definition) fail("Campo customizado inválido.","NOT_FOUND",404); const prior=await tx.customFieldValue.findUnique({where:{workspaceId_definitionId_entityType_entityId:{workspaceId:context.workspaceId,definitionId,entityType:op.entityType,entityId}}}); before=prior?{value:prior.value,revision:prior.revision}:null; const updated=await tx.customFieldValue.upsert({where:{workspaceId_definitionId_entityType_entityId:{workspaceId:context.workspaceId,definitionId,entityType:op.entityType,entityId}},create:{workspaceId:context.workspaceId,definitionId,entityType:op.entityType,entityId,value:json(payload.value),updatedByActorId:context.actorId},update:{value:json(payload.value),revision:{increment:1},updatedByActorId:context.actorId}});after={value:updated.value,revision:updated.revision};} await tx.portabilityBulkOperationItem.create({data:{workspaceId:context.workspaceId,operationId:op.id,entityId,status:"CHANGED",...(before===null?{}:{before:json(before)}),after:json(after)}}); await tx.auditLog.create({data:{workspaceId:context.workspaceId,actorId:context.actorId,action:"portability.bulk.item_changed",entityType:op.entityType,entityId,reason:op.reason,changes:json({operationId:op.id,action:op.action,before,after})}}); }
      await tx.portabilityBulkOperation.update({where:{id:op.id},data:{status:"EXECUTED",executedAt:options.now()}}); return {operationId:op.id,changed:ids.length}; });
  }
  return { screen, exportCsv, createField, tag, previewBulk, executeBulk };
}
let singleton: ReturnType<typeof createPortabilityService> | undefined;
export function getPortabilityService(){ singleton ??= createPortabilityService({database:getDatabaseClient(),authorization:getAuthorizationService(),now:()=>new Date()}); return singleton; }
