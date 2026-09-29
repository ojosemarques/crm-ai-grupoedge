import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createGeographicIntelligenceService } from "@/modules/geography/application/geographic-intelligence-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { getMetricsService } from "@/modules/metrics/application/metrics-service";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl=process.env.DATABASE_URL;if(!databaseUrl||process.env.NODE_ENV==="production")throw new Error("Backfill geográfico exige o banco local.");
const url=new URL(databaseUrl);if(!["localhost","127.0.0.1","::1"].includes(url.hostname)||decodeURIComponent(url.pathname.slice(1))!=="politizai_crm"||(url.searchParams.get("schema")??"public")!=="public")throw new Error("Backfill geográfico recusou banco, host ou schema não local.");
const mode=process.argv.includes("--execute")?"EXECUTE":"DRY_RUN";const database=getDatabaseClient();
try{const workspace=await database.workspace.findUniqueOrThrow({where:{slug:DEMO_WORKSPACE_SLUG}});const member=await database.workspaceMember.findFirstOrThrow({where:{workspaceId:workspace.id,user:{normalizedEmail:DEMO_USERS[0].email},status:"ACTIVE",deletedAt:null},select:{id:true,userId:true,roleId:true,role:{select:{key:true,name:true}},user:{select:{displayName:true}}}});const actor=await database.actor.findFirstOrThrow({where:{workspaceId:workspace.id,userId:member.userId,type:"HUMAN"}});const context:AuthenticatedContext={sessionId:randomUUID(),workspaceId:workspace.id,workspaceSlug:workspace.slug,userId:member.userId,memberId:member.id,actorId:actor.id,roleId:member.roleId,roleKey:member.role.key,roleName:member.role.name,displayName:member.user.displayName};const service=createGeographicIntelligenceService({database,authorization:createAuthorizationService({database}),metrics:getMetricsService(),now:()=>new Date()});const result=await service.runBackfill(context,{mode,idempotencyKey:`cli-${mode.toLowerCase()}-crm42-v1`});process.stdout.write(`${JSON.stringify({result},(_,value)=>typeof value==="bigint"?value.toString():value)}\n`);}finally{await database.$disconnect();}
