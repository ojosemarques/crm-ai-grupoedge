import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEMO_WORKSPACE_SLUG } from "@/modules/settings/application/demo-seed-service";

function stableId(key:string){const hex=createHash("sha256").update(`politizai:crm52:${key}`).digest("hex").slice(0,32);return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20)}`;}

export async function seedCustomerSuccessDemoData(database:PrismaClient){
 const workspace=await database.workspace.findUniqueOrThrow({where:{slug:DEMO_WORKSPACE_SLUG}});
 const actor=await database.actor.findFirstOrThrow({where:{workspaceId:workspace.id,type:"SYSTEM"}});
 const owner=await database.workspaceMember.findFirstOrThrow({where:{workspaceId:workspace.id,status:"ACTIVE",deletedAt:null,role:{key:"closer"}},include:{teamMemberships:{where:{deletedAt:null},take:1}}});
 const rule=await database.customerHealthRuleVersion.findFirstOrThrow({where:{workspaceId:workspace.id,status:"PUBLISHED"},orderBy:{version:"desc"}});
 const signals=await database.customerHealthSignalDefinition.findMany({where:{workspaceId:workspace.id,ruleVersionId:rule.id},orderBy:{position:"asc"}});
 const existing=await database.account.findMany({where:{workspaceId:workspace.id,deletedAt:null},orderBy:{name:"asc"},take:4});
 const accounts=[...existing];
 if(accounts.length<4){accounts.push(await database.account.upsert({where:{id:stableId("account:observatorio-civico")},create:{id:stableId("account:observatorio-civico"),workspaceId:workspace.id,name:"Observatório Cívico Demo",normalizedName:"observatorio civico demo",origin:"SEED",quality:"CONFIRMED",createdByActorId:actor.id,updatedByActorId:actor.id},update:{}}));}
 const now=new Date();
 const statuses=[{status:"HEALTHY" as const,score:90},{status:"ATTENTION" as const,score:58},{status:"RISK" as const,score:28},{status:"INSUFFICIENT" as const,score:null}];
 for(const [index,account] of accounts.slice(0,4).entries()){
  const assignmentId=stableId(`assignment:${account.id}`);
  await database.customerPortfolioAssignment.upsert({where:{workspaceId_idempotencyKey:{workspaceId:workspace.id,idempotencyKey:`crm52:demo:assignment:${account.id}`}},create:{id:assignmentId,workspaceId:workspace.id,accountId:account.id,ownerMemberId:owner.id,teamId:owner.teamMemberships[0]?.teamId??null,queueId:null,state:"ACTIVE",reason:"Cenário fictício controlado da carteira demonstrativa CRM-52.",priority:index===2?1:2,nextActionDescription:index===2?"Tratar risco com o cliente":"Revisar objetivo de sucesso",nextActionAt:new Date(now.getTime()+(index===2?-1:2+index)*86_400_000),validFrom:new Date(now.getTime()-10*86_400_000),idempotencyKey:`crm52:demo:assignment:${account.id}`,createdByActorId:actor.id,updatedAt:now},update:{}});
  const descriptor=statuses[index]!; const assessmentId=stableId(`health:${account.id}`);
  const assessmentExists=await database.customerHealthAssessment.findUnique({where:{workspaceId_idempotencyKey:{workspaceId:workspace.id,idempotencyKey:`crm52:demo:health:${account.id}`}},select:{id:true}});
  if(!assessmentExists) await database.customerHealthAssessment.create({data:{id:assessmentId,workspaceId:workspace.id,accountId:account.id,ruleVersionId:rule.id,cutoffAt:now,status:descriptor.status,score:descriptor.score,evidenceCount:descriptor.status==="INSUFFICIENT"?0:signals.length,missingSignalCount:descriptor.status==="INSUFFICIENT"?signals.filter(signal=>signal.required).length:0,missingSignals:descriptor.status==="INSUFFICIENT"?signals.filter(signal=>signal.required).map(signal=>({key:signal.key,freshness:"MISSING",explanation:"Cenário sem fato observado."})):[],formula:rule.formula,explanation:descriptor.status==="INSUFFICIENT"?"Dados demonstrativos obrigatórios ausentes; nenhuma nota foi inferida.":`Cenário fictício controlado ${descriptor.status.toLowerCase()} com evidências explicitamente marcadas como demonstração.`,idempotencyKey:`crm52:demo:health:${account.id}`,assessedByActorId:actor.id}});
  for(const signal of signals){const evidenceExists=await database.customerHealthEvidence.findUnique({where:{workspaceId_assessmentId_signalDefinitionId:{workspaceId:workspace.id,assessmentId,signalDefinitionId:signal.id}},select:{id:true}});if(!evidenceExists)await database.customerHealthEvidence.create({data:{id:stableId(`evidence:${account.id}:${signal.key}`),workspaceId:workspace.id,assessmentId,signalDefinitionId:signal.id,sourceEntityType:"DemoScenario",sourceEntityId:account.id,factAt:descriptor.status==="INSUFFICIENT"?null:now,observedValue:descriptor.score,present:descriptor.status!=="INSUFFICIENT",freshness:descriptor.status==="INSUFFICIENT"?"MISSING":"CURRENT",explanation:descriptor.status==="INSUFFICIENT"?"Ausência de dado registrada explicitamente.":"Evidência fictícia controlada, identificada como demonstração."}});}
 }
 return {assignments:accounts.slice(0,4).length,healthAssessments:statuses.length,ruleVersion:rule.version};
}
