import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { createRealtimeDashboardService } from "@/modules/realtime-dashboard/application/realtime-dashboard-service";

const connectionString=process.env.DATABASE_URL;if(!connectionString)throw new Error("DATABASE_URL is required.");
const database=new PrismaClient({adapter:createPostgresAdapter(connectionString,{max:12})});const now=new Date("2046-04-21T15:00:00.000Z");let workspaceId:string;let manager:AuthenticatedContext;let viewer:AuthenticatedContext;
async function context(email:string){const member=await database.workspaceMember.findFirstOrThrow({where:{workspaceId,user:{normalizedEmail:email}},include:{role:true,user:true}});const actor=await database.actor.findFirstOrThrow({where:{workspaceId,userId:member.userId,type:"HUMAN"}});return{sessionId:randomUUID(),workspaceId,workspaceSlug:"politizai",userId:member.userId,memberId:member.id,actorId:actor.id,roleId:member.roleId,roleKey:member.role.key,roleName:member.role.name,displayName:member.user.displayName}satisfies AuthenticatedContext;}
beforeAll(async()=>{workspaceId=(await seedDemoDatabase(database,{DATABASE_URL:connectionString,NODE_ENV:"test"})).workspaceId;[manager,viewer]=await Promise.all([context("gestor@demo.politizai.local"),context("viewer@demo.politizai.local")]);});afterAll(()=>database.$disconnect());
const csv=(spend=10000)=>`date,channelKey,channelName,accountKey,accountName,campaignKey,campaignName,creativeKey,creativeName,currency,timeZone,spendCents,impressions,reach,clicks,linkClicks,landingPageViews,reportedLeads,reportedPurchases,reportedRevenueCents\n2046-04-20,meta,Meta Ads,politizai,Conta Politizai,campanha-local,Campanha local,criativo-a,Criativo A,BRL,America/Sao_Paulo,${spend},1000,800,100,80,70,10,2,50000`;
describe("CRM-39 mídia paga local",()=>{
 it("aplica RBAC granular e isolamento",async()=>{const service=createMediaPerformanceService({database,now:()=>now});await expect(service.getScreen(viewer)).resolves.toMatchObject({permissions:{canImport:false}});await expect(service.previewImport(viewer,{fileName:"x.csv",csv:csv(),idempotencyKey:`viewer-${randomUUID()}`})).rejects.toBeInstanceOf(AccessDeniedError);await expect(service.getScreen({...manager,workspaceId:randomUUID()})).rejects.toBeInstanceOf(AccessDeniedError);});
 it("faz preview, confirmação, replay, correção e rollback append-only",async()=>{const service=createMediaPerformanceService({database,now:()=>now});const preview=await service.previewImport(manager,{fileName:"midia.csv",csv:csv(),idempotencyKey:`preview-${randomUUID()}`});expect(preview).toMatchObject({validCount:1,rejectedCount:0});const key=`confirm-${randomUUID()}`;const confirmed=await service.confirmImport(manager,{previewRunId:preview.id,idempotencyKey:key});expect(confirmed.createdCount).toBe(1);expect((await service.confirmImport(manager,{previewRunId:preview.id,idempotencyKey:key})).idempotentReplay).toBe(true);const correctionPreview=await service.previewImport(manager,{fileName:"midia-correcao.csv",csv:csv(12000),idempotencyKey:`preview-${randomUUID()}`});const correction=await service.confirmImport(manager,{previewRunId:correctionPreview.id,idempotencyKey:`confirm-${randomUUID()}`});expect(correction.supersededCount).toBe(1);const facts=await database.marketingPerformanceFact.findMany({where:{workspaceId}});expect(facts).toHaveLength(2);await expect(database.marketingPerformanceFact.update({where:{id:facts[0]!.id},data:{spendCents:1n}})).rejects.toThrow(/append-only/);const rolled=await service.rollbackImport(manager,{importRunId:correction.id,reason:"Correção de teste",idempotencyKey:`rollback-${randomUUID()}`});expect(rolled.createdCount).toBe(1);const screen=await service.getScreen(manager,{periodStart:"2046-04-20T00:00:00-03:00",periodEnd:"2046-04-21T23:59:59-03:00"});expect(screen.totals.spendCents).toBe(10000);const staleRollback=await service.rollbackImport(manager,{importRunId:confirmed.id,reason:"Importação já superada",idempotencyKey:`rollback-${randomUUID()}`});expect(staleRollback.createdCount).toBe(0);expect((await database.marketingPerformanceFact.findMany({where:{workspaceId}}))).toHaveLength(3);});
 it("vincula legado só por ID e reconcilia sem alterar CRM",async()=>{const service=createMediaPerformanceService({database,now:()=>now});const dry=await service.backfillHierarchy(manager,{mode:"DRY_RUN",idempotencyKey:`dry-${randomUUID()}`});expect(dry.createdCount).toBe(0);const executed=await service.backfillHierarchy(manager,{mode:"EXECUTE",idempotencyKey:`exec-${randomUUID()}`});expect(executed.candidateCount).toBeGreaterThan(0);expect(await database.marketingCampaign.count({where:{workspaceId,legacyAcquisitionCampaignId:{not:null}}})).toBeGreaterThan(0);const reconciliation=await service.reconcile(manager,{periodStart:new Date("2046-04-20T00:00:00-03:00"),periodEnd:new Date("2046-04-22T00:00:00-03:00"),idempotencyKey:`reconcile-${randomUUID()}`});expect(reconciliation.status).toMatch(/COMPLETED|PARTIAL/);});
 it("conta pessoas únicas pelo primeiro agendamento, incluindo leads antigos e reuniões futuras", async () => {
   const authorization = createAuthorizationService({ database });
   await ensureAdvertisingPipeline(database, workspaceId, manager.actorId);
   const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Anúncios", deletedAt: null } });
   const intake = createLeadIntakeService({ database, authorization, now: () => now });
   const leads: string[] = [];
   for (let index = 0; index < 4; index += 1) {
     const result = await intake.intake({ channel: "MANUAL", idempotencyKey: randomUUID(), fullName: `MQL pessoa ${index}`, phone: `+55119${87_000_000 + index}`, sourceKey: "manual", pipelineId: pipeline.id, rawPayload: {} }, manager);
     if (result.outcome === "REJECTED") throw new Error(result.issues[0]?.message ?? result.code);
     leads.push(result.leadId);
   }
   await database.lead.updateMany({ where: { id: { in: leads } }, data: { createdAt: now } });
   let sequence = 0;
   async function booking(leadId: string, occurredAt = now) {
     const startsAt = new Date(now.getTime() + (10 + sequence++) * 86_400_000);
     const meeting = await database.meeting.create({ data: {
       workspaceId, leadId, ownerMemberId: manager.memberId, title: "MQL reunião futura", startsAt,
       endsAt: new Date(startsAt.getTime() + 1_800_000), durationMinutes: 30, timeZone: "America/Sao_Paulo",
       createdByActorId: manager.actorId, updatedByActorId: manager.actorId, createdAt: occurredAt,
     } });
     await database.$transaction(tx => recordCommercialMetricFactInTransaction(tx, {
       workspaceId, eventKey: `mql:${meeting.id}`, eventType: "MEETING_SCHEDULED", occurredAt,
       sourceEntityType: "MeetingHistory", sourceEntityId: randomUUID(), leadId, meetingId: meeting.id,
       pipelineId: pipeline.id, bookedByMemberId: manager.memberId, creditedMemberId: manager.memberId,
     }));
   }
   for (const leadId of [...leads, leads[0]!, leads[1]!]) await booking(leadId);
   const service = createMediaPerformanceService({ database, now: () => now });
   const period = { periodStart: "2046-04-21", periodEnd: "2046-04-21" };
   const screen = await service.getScreen(manager, period);
   expect(screen.advertisingFunnel.byDimension.source.reduce((sum, row) => sum + row.scheduled, 0)).toBe(4);
   expect(screen).toMatchObject({ advertisingBookings: 4 });
   const original = await database.lead.findUniqueOrThrow({ where: { id: leads[0]! } });
   const duplicateCard = await database.lead.create({ data: {
     workspaceId, contactId: original.contactId, sourceId: original.sourceId, ownerMemberId: manager.memberId,
     pipelineId: pipeline.id, currentStageId: original.currentStageId, fullName: "Segunda ficha da mesma pessoa",
     slaStartedAt: now, slaDueAt: now, lastActivityAt: now,
     createdByActorId: manager.actorId, updatedByActorId: manager.actorId, createdAt: new Date("2046-04-20T12:00:00Z"),
   } });
   await booking(duplicateCard.id);
   expect((await service.getScreen(manager, period)).advertisingBookings).toBe(4);
   const old = await intake.intake({ channel: "MANUAL", idempotencyKey: randomUUID(), fullName: "MQL lead anterior", phone: "+5511987000010", sourceKey: "manual", pipelineId: pipeline.id, rawPayload: {} }, manager);
   if (old.outcome === "REJECTED") throw new Error(old.issues[0]?.message ?? old.code);
   await database.lead.update({ where: { id: old.leadId }, data: { createdAt: new Date("2046-04-20T12:00:00Z") } });
   await booking(old.leadId);
   expect((await service.getScreen(manager, period)).advertisingBookings).toBe(5);
   await booking(old.leadId, new Date("2046-04-20T23:59:00-03:00"));
   await booking(old.leadId, new Date("2046-04-22T00:00:00-03:00"));
   const updated = await service.getScreen(manager, period);
   expect(updated).toMatchObject({ advertisingBookings: 4 });
   expect(updated.advertisingFunnel.cohortSize).toBe(4);
   const realtime = createRealtimeDashboardService({ database, authorization, now: () => new Date(now.getTime() + 1000) });
   expect((await realtime.screen(manager, "ADVERTISING")).snapshot.today.totals.meetingsScheduled).toBe(4);
 });

});
