import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createContractService } from "@/modules/contracts/application/contract-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPaymentBackfillService } from "@/modules/payments/application/payment-backfill-service";
import { localPaymentSandbox } from "@/modules/payments/application/payment-sandbox-adapter";
import { createPaymentService } from "@/modules/payments/application/payment-service";
import { createPaymentWorkerService } from "@/modules/payments/application/payment-worker-service";
import { PAYMENT_CONTRACT_VERSION, signPaymentWebhook } from "@/modules/payments/domain/payment-contracts";
import { createRevenueService } from "@/modules/revenue/application/revenue-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw new Error("DATABASE_URL is required for CRM-50 tests.");
if(!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA??""))throw new Error("CRM-50 requires an ephemeral test schema.");
const database=new PrismaClient({adapter:createPostgresAdapter(connectionString,{max:16})});
const authorization=createAuthorizationService({database});
let clock=new Date("2049-01-10T15:00:00.000Z"); let workspaceId:string; let admin:AuthenticatedContext; let viewer:AuthenticatedContext; let subscriptionId:string;
async function context(email:string){const member=await database.workspaceMember.findFirstOrThrow({where:{workspaceId,user:{normalizedEmail:email}},include:{role:true,user:true}});const actor=await database.actor.findFirstOrThrow({where:{workspaceId,userId:member.userId,type:"HUMAN"}});return {sessionId:randomUUID(),workspaceId,workspaceSlug:"politizai",userId:member.userId,memberId:member.id,actorId:actor.id,roleId:member.roleId,roleKey:member.role.key,roleName:member.role.name,displayName:member.user.displayName} satisfies AuthenticatedContext;}
const payments=()=>createPaymentService({database,now:()=>clock});
const worker=()=>createPaymentWorkerService({database,adapter:localPaymentSandbox,now:()=>clock,backoffBaseSeconds:1});

beforeAll(async()=>{
  workspaceId=(await seedDemoDatabase(database,{DATABASE_URL:connectionString,NODE_ENV:"test"})).workspaceId;
  [admin,viewer]=await Promise.all([context("admin@demo.politizai.local"),context("viewer@demo.politizai.local")]);
  const systemActor=await database.actor.findFirstOrThrow({where:{workspaceId,type:"SYSTEM"},orderBy:{id:"asc"}});
  const system={workspaceId,actorId:systemActor.id,actorKey:systemActor.key,actorType:"SYSTEM"} satisfies ServiceActorContext;
  const intake=await createLeadIntakeService({database,authorization,now:()=>clock}).intake({channel:"MANUAL",idempotencyKey:"crm50:fixture:lead",fullName:"Cliente sandbox fictício",phone:"+5511987654321",jobTitle:"Responsável financeiro",interestSummary:"Teste local de cobrança e pagamento.",sourceKey:"manual",priorityBandCode:"P1",rawPayload:{test:"crm50",simulated:true}},system);
  if(intake.outcome==="REJECTED")throw new Error(intake.code);
  const account=await database.account.create({data:{workspaceId,name:"Conta Sandbox Fictícia",normalizedName:"conta sandbox ficticia",origin:"SEED",quality:"CONFIRMED",createdByActorId:system.actorId,updatedByActorId:system.actorId}});
  const contact=await database.contact.create({data:{workspaceId,preferredName:"Cliente sandbox fictício",origin:"LEAD_BACKFILL",quality:"CONFIRMED",createdByActorId:system.actorId,updatedByActorId:system.actorId}});
  await database.lead.update({where:{id:intake.leadId},data:{accountId:account.id,contactId:contact.id,updatedByActorId:system.actorId}});
  const [pipeline,owner,product]=await Promise.all([database.pipeline.findFirstOrThrow({where:{workspaceId,entityType:"OPPORTUNITY",isDefault:true},include:{stages:{where:{deletedAt:null},orderBy:{position:"asc"},take:1}}}),database.workspaceMember.findFirstOrThrow({where:{workspaceId,user:{normalizedEmail:"closer1@demo.politizai.local"}}}),database.product.findFirstOrThrow({where:{workspaceId,active:true,deletedAt:null}})]);
  const opportunity=await database.opportunity.create({data:{workspaceId,leadId:intake.leadId,accountId:account.id,pipelineId:pipeline.id,currentStageId:pipeline.stages[0]!.id,ownerMemberId:owner.id,productId:product.id,name:"Venda sandbox fictícia",status:"OPEN",amountCents:9900n,mrrCents:9900n,tcvCents:118800n,probabilityBps:5000,createdByActorId:system.actorId,updatedByActorId:system.actorId}});
  const offer=await database.offer.create({data:{workspaceId,opportunityId:opportunity.id,productId:product.id,name:"Plano sandbox",quantity:1,unitPriceCents:9900n,totalCents:9900n,createdByActorId:system.actorId,updatedByActorId:system.actorId}});
  const contractService=createContractService({database,authorization,now:()=>clock}); const screen=await contractService.getScreen(admin,{});
  const created=await contractService.create(admin,{opportunityId:opportunity.id,offerId:offer.id,templateVersionId:screen.templateVersions[0]!.id,billingFrequency:"MONTHLY",durationMonths:12,paymentTerms:"Pagamento mensal em sandbox local.",renewalExpected:true,idempotencyKey:"crm50:contract:create"});
  await contractService.act(admin,created.contractId,{action:"REQUEST_REVIEW",expectedRevision:1,idempotencyKey:"crm50:contract:review",reason:"Revisão local controlada.",confirmed:true});
  await contractService.act(admin,created.contractId,{action:"MARK_READY",expectedRevision:2,idempotencyKey:"crm50:contract:ready",confirmed:true});
  await contractService.act(admin,created.contractId,{action:"ISSUE",expectedRevision:3,idempotencyKey:"crm50:contract:issue",confirmed:true});
  await contractService.act(admin,created.contractId,{action:"SEND_SIMULATED",expectedRevision:4,idempotencyKey:"crm50:contract:send",confirmed:true});
  await contractService.act(admin,created.contractId,{action:"ACCEPT_LOCAL",expectedRevision:5,idempotencyKey:"crm50:contract:accept",acceptedByName:"Cliente fictício",acceptedByRole:"Responsável",evidenceText:"Aceite exclusivamente local para teste.",effectiveStartsAt:clock.toISOString(),effectiveEndsAt:"2050-01-10T15:00:00.000Z",confirmed:true});
  const revenue=createRevenueService(database,authorization); const subscription=await revenue.create(admin,{contractId:created.contractId,quantity:1,recurringPriceCents:9900n,billingInterval:"MONTHLY",startsAt:clock});
  await revenue.action(admin,subscription.id,{action:"ACTIVATE",effectiveAt:clock,reason:"Ativação sandbox local",idempotencyKey:"crm50:subscription:activate"}); subscriptionId=subscription.id;
});
afterAll(async()=>database.$disconnect());

async function invoice(key:string,start="2049-01-01T03:00:00.000Z",end="2049-02-01T03:00:00.000Z"){return payments().createInvoice(admin,{subscriptionId,billingPeriodStart:start,billingPeriodEnd:end,dueAt:end,idempotencyKey:key});}

describe("CRM-50 pagamentos em sandbox",()=>{
  it("cria snapshot idempotente, emite e confirma sem fabricar receita",async()=>{const created=await invoice("crm50:invoice:success");await expect(invoice("crm50:invoice:success")).resolves.toMatchObject({id:created.id});await expect(database.invoiceLine.update({where:{id:(await database.invoiceLine.findFirstOrThrow({where:{invoiceId:created.id}})).id},data:{quantity:2}})).rejects.toThrow(/append-only/);await payments().act(admin,created.id,{action:"ISSUE",expectedRevision:1,reason:"Emissão local aprovada."});await payments().act(admin,created.id,{action:"CHARGE",expectedRevision:2,scenario:"SUCCESS",idempotencyKey:"crm50:charge:success"});expect((await worker().processNext("crm50-worker" )).status).toBe("PROVIDER_ACCEPTED");expect((await worker().processNext("crm50-worker" )).status).toBe("PROCESSED");await expect(database.invoice.findUniqueOrThrow({where:{id:created.id}})).resolves.toMatchObject({status:"PAID",paidCents:9900n});expect(await database.payment.count({where:{workspaceId,invoiceId:created.id}})).toBe(1);expect(await database.revenueMovement.count({where:{workspaceId,subscriptionId}})).toBe(1);});
  it("mantém recusa, falha permanente e chargeback como estados distintos",async()=>{const declined=await invoice("crm50:invoice:declined","2049-03-01T03:00:00.000Z","2049-04-01T03:00:00.000Z");await payments().act(admin,declined.id,{action:"ISSUE",expectedRevision:1,reason:"Emissão para recusa."});await payments().act(admin,declined.id,{action:"CHARGE",expectedRevision:2,scenario:"DECLINED",idempotencyKey:"crm50:charge:declined"});expect((await worker().processNext("crm50-declined")).status).toBe("DECLINED");await expect(database.invoice.findUniqueOrThrow({where:{id:declined.id}})).resolves.toMatchObject({status:"OPEN",paidCents:0n});const failure=await invoice("crm50:invoice:failure","2049-04-01T03:00:00.000Z","2049-05-01T03:00:00.000Z");await payments().act(admin,failure.id,{action:"ISSUE",expectedRevision:1,reason:"Emissão para falha terminal."});await payments().act(admin,failure.id,{action:"CHARGE",expectedRevision:2,scenario:"PERMANENT_FAILURE",idempotencyKey:"crm50:charge:failure"});expect((await worker().processNext("crm50-failure")).status).toBe("DEAD_LETTER");const chargeback=await invoice("crm50:invoice:chargeback","2049-05-01T03:00:00.000Z","2049-06-01T03:00:00.000Z");await payments().act(admin,chargeback.id,{action:"ISSUE",expectedRevision:1,reason:"Emissão para chargeback."});await payments().act(admin,chargeback.id,{action:"CHARGE",expectedRevision:2,scenario:"CHARGEBACK",idempotencyKey:"crm50:charge:chargeback"});expect((await worker().processNext("crm50-chargeback")).status).toBe("PROVIDER_ACCEPTED");expect((await worker().processNext("crm50-chargeback")).status).toBe("PROCESSED");expect((await worker().processNext("crm50-chargeback")).status).toBe("PROCESSED");await expect(database.invoice.findUniqueOrThrow({where:{id:chargeback.id}})).resolves.toMatchObject({status:"OPEN",paidCents:0n});await expect(database.payment.findFirstOrThrow({where:{workspaceId,invoiceId:chargeback.id}})).resolves.toMatchObject({status:"CHARGEBACK"});});
  it("rejeita assinatura inválida sem receipt, deduplica webhook e exige reconciliação",async()=>{const before=await database.paymentWebhookReceipt.count({where:{workspaceId}});const body=JSON.stringify({contractVersion:PAYMENT_CONTRACT_VERSION,eventId:"crm50.event.duplicate.001",nonce:"crm50_nonce_duplicate_001",eventType:"PAYMENT_REVERSED",occurredAt:clock.toISOString(),invoiceNumber:"INV-INEXISTENTE",externalPaymentId:"payment-inexistente",amountCents:9900,currency:"BRL",reasonCode:"TEST"});await expect(payments().ingestSignedLocalWebhook(workspaceId,Buffer.from(body),clock.toISOString(),"sha256=invalid")).rejects.toThrow();expect(await database.paymentWebhookReceipt.count({where:{workspaceId}})).toBe(before);const signature=signPaymentWebhook(clock.toISOString(),body,{NODE_ENV:"test"});const first=await payments().ingestSignedLocalWebhook(workspaceId,Buffer.from(body),clock.toISOString(),signature);await expect(payments().ingestSignedLocalWebhook(workspaceId,Buffer.from(body),clock.toISOString(),signature)).resolves.toMatchObject({receiptId:first.receiptId,idempotent:true});expect((await worker().processNext("crm50-unmatched")).status).toBe("REVIEW_REQUIRED");const issue=await database.paymentReconciliationIssue.findFirstOrThrow({where:{workspaceId,status:"OPEN",reason:"UNMATCHED_INVOICE"}});await expect(payments().screen(admin)).resolves.toMatchObject({metrics:{divergenceCount:1},reconciliationIssues:[{id:issue.id}]});await expect(payments().resolveIssue(viewer,issue.id,{action:"DISMISS",reason:"Revisão sem permissão."})).rejects.toBeInstanceOf(AccessDeniedError);await expect(payments().resolveIssue(admin,issue.id,{action:"DISMISS",reason:"Evento fictício sem cobrança correspondente."})).resolves.toMatchObject({issue:{status:"DISMISSED"}});await expect(payments().screen(admin)).resolves.toMatchObject({metrics:{divergenceCount:0},reconciliationIssues:[]});});
  it("agenda retry, entra em dead-letter e permite replay autorizado",async()=>{const created=await invoice("crm50:invoice:timeout","2049-02-01T03:00:00.000Z","2049-03-01T03:00:00.000Z");await payments().act(admin,created.id,{action:"ISSUE",expectedRevision:1,reason:"Emissão para timeout."});const queued=await payments().act(admin,created.id,{action:"CHARGE",expectedRevision:2,scenario:"TIMEOUT",idempotencyKey:"crm50:charge:timeout"});if(!("attempt" in queued)||!queued.attempt)throw new Error("A tentativa idempotente não foi criada.");expect((await worker().processNext("crm50-timeout")).status).toBe("RETRY_PENDING");clock=new Date(clock.getTime()+2_000);expect((await worker().processNext("crm50-timeout")).status).toBe("RETRY_PENDING");clock=new Date(clock.getTime()+3_000);expect((await worker().processNext("crm50-timeout")).status).toBe("DEAD_LETTER");await expect(payments().act(viewer,created.id,{action:"REPLAY",attemptId:queued.attempt.id,reason:"Tentativa não autorizada."})).rejects.toBeInstanceOf(AccessDeniedError);await expect(payments().act(admin,created.id,{action:"REPLAY",attemptId:queued.attempt.id,reason:"Reprocessamento manual autorizado."})).resolves.toMatchObject({idempotent:false});});
  it("backfill é conservador, auditável e idempotente",async()=>{const service=createPaymentBackfillService(database);const invoiceCount=await database.invoice.count({where:{workspaceId}});const first=await service.run(admin,{mode:"DRY_RUN",idempotencyKey:"crm50:backfill:dry"});expect(first).toMatchObject({replayed:false});expect(await database.invoice.count({where:{workspaceId}})).toBe(invoiceCount);await expect(service.run(admin,{mode:"DRY_RUN",idempotencyKey:"crm50:backfill:dry"})).resolves.toMatchObject({id:first.id,replayed:true});});
});

describe("recebimento manual real integrado", () => {
  async function setup(key: string, month: number) {
    const created = await invoice(key, `2048-${String(month).padStart(2, "0")}-01T03:00:00.000Z`, `2048-${String(month + 1).padStart(2, "0")}-01T03:00:00.000Z`);
    await payments().act(admin, created.id, { action: "ISSUE", expectedRevision: 1, reason: "Cobrança real aguardando recebimento." });
    const financialAccount = await database.financialAccount.create({ data: { workspaceId, name: key, type: "BANK", openingBalanceCents: 0n, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    return { invoiceId: created.id, financialAccountId: financialAccount.id, expectedRevision: 2, amountCents: "4000", receivedAt: clock.toISOString(), method: "PIX" as const, reference: `recibo-${key}` };
  }

  it("prévia não grava; confirmação parcial e final atualizam cobrança, caixa, conta e métricas sem duplicar MRR", async () => {
    const { createFinanceService } = await import("@/modules/finance/application/finance-service");
    const { createRevenueMetricsService } = await import("@/modules/metrics/application/revenue-metrics-service");
    const finance = createFinanceService({ database, authorization, now: () => clock });
    const metrics = createRevenueMetricsService({ database, authorization, now: () => clock });
    const input = await setup("manual-receipt-success", 6);
    const before = await finance.screen(admin, { from: "2049-01-01", to: "2049-02-01" });
    const preview = await payments().previewReceipt(admin, input);
    expect(preview.preview).toMatchObject({ amountCents: "4000", outstandingAfterCents: "5900", statusAfter: "PARTIALLY_PAID" });
    expect(await database.payment.count({ where: { workspaceId, invoiceId: input.invoiceId } })).toBe(0);
    const command = { ...preview.input, confirmed: true, idempotencyKey: randomUUID() };
    const first = await payments().recordReceipt(admin, command);
    expect(first).toMatchObject({ idempotent: false, invoice: { paidCents: 4000n, status: "PARTIALLY_PAID", revision: 3 }, payment: { providerKey: "MANUAL_RECEIPT" } });
    await expect(payments().recordReceipt(admin, command)).resolves.toMatchObject({ idempotent: true, payment: { id: first.payment.id } });
    const second = await payments().recordReceipt(admin, { ...input, expectedRevision: 3, amountCents: "5900", reference: "recibo-final-success", confirmed: true, idempotencyKey: randomUUID() });
    expect(second.invoice).toMatchObject({ paidCents: 9900n, status: "PAID", paidAt: clock, revision: 4 });
    const after = await finance.screen(admin, { from: "2049-01-01", to: "2049-02-01" });
    expect(BigInt(after.summary.receivedCents) - BigInt(before.summary.receivedCents)).toBe(9900n);
    expect(after.accounts.find((row) => row.id === input.financialAccountId)?.balanceCents).toBe("9900");
    expect(after.summary.unallocatedPaymentBalanceCents).toBe("0");
    expect(after.summary.mrrCents).toBe(before.summary.mrrCents);
    expect(await database.financialEntry.count({ where: { workspaceId, financialAccountId: input.financialAccountId } })).toBe(0);
    clock = new Date(clock.getTime() + 1000);
    const screen = await metrics.getScreen(admin, { preset: "CUSTOM", fromDate: "2049-01-01", toDate: "2049-01-31" });
    expect(screen.metrics.find((row) => row.metricId === "cash.received")?.value).toBe(after.summary.receivedCents);
    expect(await database.auditLog.count({ where: { workspaceId, action: "payment.receipt.recorded", entityId: { in: [first.payment.id, second.payment.id] } } })).toBe(2);
  });

  it("inclui entrada avulsa no caixa e reconstrói quitação anterior ao período comparado", async () => {
    const { createFinanceService } = await import("@/modules/finance/application/finance-service");
    const { createRevenueMetricsService } = await import("@/modules/metrics/application/revenue-metrics-service");
    const finance = createFinanceService({ database, authorization, now: () => clock });
    const metrics = createRevenueMetricsService({ database, authorization, now: () => clock });
    const input = await setup("manual-receipt-historical", 10);
    await payments().recordReceipt(admin, { ...input, amountCents: "9900", receivedAt: "2048-11-05T15:00:00Z", confirmed: true, idempotencyKey: randomUUID() });
    const category = await finance.command(admin, { action: "CREATE_CATEGORY", key: "receipt_other_income", name: "Entrada avulsa", kind: "INCOME" }) as { id: string };
    await finance.command(admin, { action: "CREATE_ENTRY", financialAccountId: input.financialAccountId, categoryId: category.id, direction: "INCOME", status: "SETTLED", amountCents: "1234", description: "Receita avulsa sem cobrança", competenceAt: clock, dueAt: clock, settledAt: clock, idempotencyKey: "receipt:manual-income" });
    clock = new Date(clock.getTime() + 1000);
    const screen = await metrics.getScreen(admin, { preset: "CUSTOM", fromDate: "2049-01-01", toDate: "2049-01-31" });
    const financial = await finance.screen(admin);
    expect(screen.metrics.find((row) => row.metricId === "cash.received")?.value).toBe(financial.summary.receivedCents);
    const cash = await metrics.getDrilldown(admin, { preset: "CUSTOM", fromDate: "2049-01-01", toDate: "2049-01-31", metric: "cash.received" });
    expect(cash.records).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: "FINANCIAL_ENTRY", contribution: "1234" })]));
    const overdue = await metrics.getDrilldown(admin, { preset: "CUSTOM", fromDate: "2049-01-01", toDate: "2049-01-31", metric: "cash.delinquency" });
    expect(overdue.records.find((row) => row.entityId === input.invoiceId)?.contribution).toBe("0");
  });

  it("rejeita confirmação ausente, excesso, futuro, revisão antiga, referência duplicada e chave reutilizada", async () => {
    const input = await setup("manual-receipt-invalid", 7);
    const command = { ...input, confirmed: true, idempotencyKey: randomUUID() };
    await expect(payments().recordReceipt(admin, { ...command, confirmed: false })).rejects.toThrow();
    await expect(payments().previewReceipt(admin, { ...input, amountCents: "9901" })).rejects.toMatchObject({ code: "PAYMENT_RECEIPT_OVERPAYMENT" });
    await expect(payments().previewReceipt(admin, { ...input, receivedAt: "2050-01-01" })).rejects.toMatchObject({ code: "PAYMENT_RECEIPT_FUTURE_DATE" });
    await payments().recordReceipt(admin, command);
    await expect(payments().recordReceipt(admin, { ...command, amountCents: "1000" })).rejects.toMatchObject({ code: "PAYMENT_RECEIPT_IDEMPOTENCY_CONFLICT" });
    await expect(payments().recordReceipt(admin, { ...command, idempotencyKey: randomUUID(), reference: "another-reference" })).rejects.toMatchObject({ code: "PAYMENT_VERSION_CONFLICT" });
    await expect(payments().recordReceipt(admin, { ...command, idempotencyKey: randomUUID(), expectedRevision: 3 })).rejects.toMatchObject({ code: "PAYMENT_RECEIPT_DUPLICATE_REFERENCE" });
    expect(await database.payment.count({ where: { workspaceId, invoiceId: input.invoiceId } })).toBe(1);
  });

  it("nega operador sem permissão e conta ou cobrança de outro workspace", async () => {
    const input = await setup("manual-receipt-permissions", 8);
    await expect(payments().previewReceipt(viewer, input)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(payments().recordReceipt(viewer, { ...input, confirmed: true, idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(payments().previewReceipt(admin, { ...input, financialAccountId: randomUUID() })).rejects.toMatchObject({ code: "FINANCE_ACCOUNT_NOT_FOUND" });
    await expect(payments().previewReceipt(admin, { ...input, invoiceId: randomUUID() })).rejects.toMatchObject({ code: "PAYMENT_INVOICE_NOT_FOUND" });
    expect(await database.payment.count({ where: { workspaceId, invoiceId: input.invoiceId } })).toBe(0);
  });

  it("respeita escopo OWN e TEAM mesmo quando o operador administra todo o financeiro", async () => {
    const own = await setup("manual-receipt-scoped-own", 1);
    const foreign = await setup("manual-receipt-scoped-foreign", 2);
    await database.invoice.update({ where: { id: foreign.invoiceId }, data: { ownerMemberId: admin.memberId } });
    const original = await context("closer1@demo.politizai.local");
    const role = await database.role.create({ data: { workspaceId, key: "receipt_scoped_operator", name: "Recebimentos próprios", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const grants = await database.permission.findMany({ where: { key: { in: ["finance.read", "finance.manage", "payments.read", "payments.manage", "payments.reconcile"] } } });
    await database.rolePermission.createMany({ data: grants.map((permission) => ({ workspaceId, roleId: role.id, permissionId: permission.id, scope: permission.key.startsWith("payments.") ? "OWN" as const : "WORKSPACE" as const, createdByActorId: admin.actorId })) });
    await database.workspaceMember.update({ where: { id: original.memberId }, data: { roleId: role.id } });
    const issue = await database.paymentReconciliationIssue.create({ data: { workspaceId, ownerMemberId: original.memberId, reason: "UNMATCHED_INVOICE", evidenceHash: "scoped-reconciliation-evidence" } });
    try {
      for (const scope of ["OWN", "TEAM"] as const) {
        await database.rolePermission.updateMany({ where: { workspaceId, roleId: role.id, permissionId: { in: grants.filter((item) => item.key.startsWith("payments.")).map((item) => item.id) } }, data: { scope } });
        const operator = await context("closer1@demo.politizai.local");
        const service = payments();
        const screen = await service.screen(operator);
        expect(screen.invoices.some((row) => row.id === own.invoiceId)).toBe(true);
        expect(screen.invoices.some((row) => row.id === foreign.invoiceId)).toBe(false);
        await expect(service.detail(operator, own.invoiceId)).resolves.toMatchObject({ invoice: { id: own.invoiceId } });
        await expect(service.detail(operator, foreign.invoiceId)).rejects.toBeInstanceOf(AccessDeniedError);
        const foreignInvoiceInput = { subscriptionId, billingPeriodStart: "2048-02-01T03:00:00.000Z", billingPeriodEnd: "2048-03-01T03:00:00.000Z", dueAt: "2048-03-01T03:00:00.000Z" };
        await expect(service.createInvoice(operator, { ...foreignInvoiceInput, idempotencyKey: "manual-receipt-scoped-foreign" })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(service.createInvoice(operator, { ...foreignInvoiceInput, idempotencyKey: `scoped-existing:${scope}` })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(service.createInvoice(operator, { ...foreignInvoiceInput, idempotencyKey: `invoice-issued:${foreign.invoiceId}:r2` })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(service.createInvoice(operator, { ...foreignInvoiceInput, billingPeriodStart: "2048-01-01T03:00:00.000Z", billingPeriodEnd: "2048-02-01T03:00:00.000Z", idempotencyKey: "manual-receipt-scoped-own" })).resolves.toMatchObject({ id: own.invoiceId });
        await expect(service.resolveIssue(operator, issue.id, { action: "LINK_AND_REPROCESS", invoiceId: foreign.invoiceId, reason: "Tentativa de vincular cobrança de outro dono." })).rejects.toBeInstanceOf(AccessDeniedError);
        expect(await database.paymentReconciliationIssue.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({ status: "OPEN", invoiceId: null });

        await expect(service.previewReceipt(operator, { ...own, expectedRevision: scope === "OWN" ? 2 : 3 })).resolves.toMatchObject({ input: { invoiceId: own.invoiceId } });
        await expect(service.previewReceipt(operator, foreign)).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(service.recordReceipt(operator, { ...foreign, confirmed: true, idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(service.recordReceipt(operator, { ...own, expectedRevision: scope === "OWN" ? 2 : 3, amountCents: "1000", reference: `${own.reference}:${scope}`, confirmed: true, idempotencyKey: randomUUID() })).resolves.toMatchObject({ invoice: { paidCents: scope === "OWN" ? 1000n : 2000n } });
      }
      expect(await database.payment.count({ where: { workspaceId, invoiceId: foreign.invoiceId } })).toBe(0);
    } finally {
      await database.workspaceMember.update({ where: { id: original.memberId }, data: { roleId: original.roleId } });
    }
  });

  it("serializa confirmações simultâneas e preserva apenas uma baixa", async () => {
    const input = await setup("manual-receipt-concurrent", 9);
    const command = { ...input, confirmed: true, idempotencyKey: randomUUID() };
    const results = await Promise.all([payments().recordReceipt(admin, command), payments().recordReceipt(admin, command)]);
    expect(results.filter((item) => item.idempotent)).toHaveLength(1);
    expect(new Set(results.map((item) => item.payment.id)).size).toBe(1);
    expect(await database.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } })).toMatchObject({ paidCents: 4000n, revision: 3 });
  });
});
