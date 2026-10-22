import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { calculateSale, expectedOte, isNewAcv, oteCommandSchema, oteQuerySchema, releaseSchedule } from "@/modules/ote/domain/ote-calculator";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { addWorkspaceCalendarDays, workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

type Options = { database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>; now: () => Date };
const conflict = () => { throw new ApplicationError("O registro mudou. Atualize a página antes de salvar.", { code: "OTE_CONFLICT", statusCode: 409, expose: true }); };
function invalid(message: string): never { throw new ApplicationError(message, { code: "INVALID_OTE_FACT", statusCode: 400, expose: true }); }

export function createOteService({ database, authorization, now }: Options) {
  async function assertContext(context: AuthenticatedContext) {
    const [member, actor] = await Promise.all([
      database.workspaceMember.findFirst({ where: { id: context.memberId, workspaceId: context.workspaceId, userId: context.userId, roleId: context.roleId, status: "ACTIVE", deletedAt: null, role: { deletedAt: null }, workspace: { status: "ACTIVE", deletedAt: null } }, select: { role: { select: { key: true } } } }),
      database.actor.findFirst({ where: { id: context.actorId, workspaceId: context.workspaceId, userId: context.userId, type: "HUMAN" }, select: { id: true } }),
    ]);
    if (!member || !actor) throw new AccessDeniedError();
    return member.role.key === "administrator";
  }
  async function assertAdmin(context: AuthenticatedContext) {
    if (!await assertContext(context)) throw new AccessDeniedError();
    await authorization.assertAuthorized(context, PermissionKeys.WORKSPACE_MEMBERS_MANAGE, { workspaceId: context.workspaceId, resourceType: "OtePlan" });
  }
  async function period(context: AuthenticatedContext, raw: unknown) {
    const input = oteQuerySchema.parse(raw);
    const workspace = await database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
    const month = input.month ?? workspaceDateAt(now(), workspace.timeZone).slice(0, 7);
    const [year, monthNumber] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year!, monthNumber!, 1)).toISOString().slice(0, 10);
    return { month, from: workspaceDayRange(`${month}-01`, workspace.timeZone).start, to: workspaceDayRange(next, workspace.timeZone).start, timeZone: workspace.timeZone };
  }
  async function screen(context: AuthenticatedContext, raw: unknown = {}) {
    const canManage = await assertContext(context);
    const range = await period(context, raw);
    const plan = await database.otePlan.findFirst({ where: { workspaceId: context.workspaceId, memberId: context.memberId, effectiveMonth: { lte: range.month } }, orderBy: { effectiveMonth: "desc" } });
    const base = { month: range.month, timeZone: range.timeZone, name: context.displayName, canManage };
    if (!plan) return { ...base, plan: null, sales: [], meetings: [], pendingSales: 0, summary: null };
    const at = now();
    const dateFilter = { gte: range.from, lt: range.to, lte: at };
    // Ownership always comes from the validated session, never a query/body memberId.
    const won = await database.opportunity.findMany({ where: { workspaceId: context.workspaceId, status: "WON", deletedAt: null, closedAt: dateFilter, currency: "BRL", ...(plan.role === "SDR" ? { id: { in: (await database.oteSale.findMany({ where: { workspaceId: context.workspaceId, sdrMemberId: context.memberId }, select: { opportunityId: true } })).map((s) => s.opportunityId) } } : { ownerMemberId: context.memberId }) }, select: { id: true, name: true, closedAt: true, ownerMemberId: true }, orderBy: [{ closedAt: "asc" }, { id: "asc" }] });
    const facts = await database.oteSale.findMany({ where: { workspaceId: context.workspaceId, opportunityId: { in: won.map((s) => s.id) }, ...(plan.role === "SDR" ? { sdrMemberId: context.memberId } : { sellerMemberId: context.memberId }) } });
    if (plan.role === "SDR") {
      const qualified = await database.oteMeeting.findMany({ where: { workspaceId: context.workspaceId, sdrMemberId: context.memberId, qualified: true } });
      const meetings = await database.meeting.findMany({ where: { workspaceId: context.workspaceId, id: { in: qualified.map((m) => m.meetingId) }, status: "COMPLETED", deletedAt: null, completedAt: dateFilter }, select: { id: true, title: true, completedAt: true }, orderBy: { completedAt: "asc" } });
      const variable = BigInt(meetings.length) * 4000n + BigInt(won.length) * 10000n;
      return { ...base, plan: planView(plan), pendingSales: 0, meetings: meetings.map((m) => ({ id: m.id, name: m.title, date: m.completedAt!.toISOString(), amountCents: "4000" })), sales: won.map((s) => ({ id: s.id, name: s.name, date: s.closedAt!.toISOString(), kind: "SDR", acvCents: "0", receivedCents: "0", projectedCents: "10000", eligibleCents: "10000", rate: "R$ 100 por cliente originado", selfSourced: false, schedule: [], eligible: true })), summary: { newAcvCents: "0", commissionCents: variable.toString(), bonusCents: "0", totalCents: (plan.fixedCents + variable).toString(), eligibleCents: variable.toString(), meetingCount: meetings.length, saleCount: won.length } };
    }
    const contracts = await database.commercialContract.findMany({ where: { workspaceId: context.workspaceId, opportunityId: { in: facts.map((s) => s.opportunityId) } }, select: { id: true, opportunityId: true } });
    const contractIds = contracts.map((c) => c.id);
    const [subscriptions, invoices] = await Promise.all([
      database.subscription.findMany({ where: { workspaceId: context.workspaceId, contractId: { in: contractIds } }, select: { contractId: true, status: true, startsAt: true, endsAt: true, cancellationEffectiveAt: true } }),
      database.invoice.findMany({ where: { workspaceId: context.workspaceId, contractId: { in: contractIds } }, select: { id: true, contractId: true, totalCents: true, paidCents: true, dueAt: true, status: true } }),
    ]);
    const payments = await database.payment.findMany({ where: { workspaceId: context.workspaceId, invoiceId: { in: invoices.map((i) => i.id) }, status: "CONFIRMED", reversedAt: null, occurredAt: { lte: at }, currency: "BRL" }, select: { invoiceId: true, amountCents: true } });
    let newAcv = 0n;
    const sales = won.flatMap((sale) => {
      const fact = facts.find((f) => f.opportunityId === sale.id);
      if (!fact) return [];
      const contract = contracts.find((c) => c.opportunityId === sale.id);
      const subscription = subscriptions.find((s) => s.contractId === contract?.id);
      const saleInvoices = invoices.filter((i) => i.contractId === contract?.id);
      const received = payments.filter((p) => saleInvoices.some((i) => i.id === p.invoiceId)).reduce((sum, p) => sum + p.amountCents, 0n);
      const active = Boolean(subscription && ["ACTIVE", "CANCELLATION_SCHEDULED"].includes(subscription.status) && subscription.startsAt <= at && (!subscription.endsAt || subscription.endsAt > at) && (!subscription.cancellationEffectiveAt || subscription.cancellationEffectiveAt > at));
      const activeAndCurrent = active && received > 0n && !saleInvoices.some((i) => !["DRAFT", "VOIDED", "CANCELLED"].includes(i.status) && i.dueAt < at && i.paidCents < i.totalCents);
      const eligible = fact.kind === "ANNUAL_MONTHLY" ? activeAndCurrent : fact.kind === "ANNUAL_UPFRONT" ? active && received > 0n : fact.kind === "PROJECT" ? received > 0n : true;
      const calculation = calculateSale({ kind: fact.kind, acvCents: fact.acvCents, receivedCents: received, selfSourced: fact.selfSourced, priorNewAcvCents: newAcv, quotaCents: plan.quotaCents });
      if (isNewAcv(fact.kind)) newAcv += fact.acvCents;
      const schedule = fact.kind === "ANNUAL_MONTHLY" ? releaseSchedule(calculation.projectedCents, [30, 60, 90].map((days) => addWorkspaceCalendarDays(sale.closedAt!, days, range.timeZone)), at, eligible) : [];
      const eligibleCents = fact.kind === "ANNUAL_MONTHLY" ? schedule.filter((s) => s.eligible).reduce((sum, s) => sum + BigInt(s.amountCents), 0n) : eligible ? calculation.receiptCommissionCents : 0n;
      return [{ id: sale.id, name: sale.name, date: sale.closedAt!.toISOString(), kind: fact.kind, acvCents: fact.acvCents.toString(), receivedCents: received.toString(), projectedCents: calculation.projectedCents.toString(), eligibleCents: eligibleCents.toString(), rate: calculation.rate, selfSourced: fact.selfSourced, schedule, eligible }];
    });
    const commission = sales.reduce((sum, s) => sum + BigInt(s.projectedCents), 0n);
    const bonus = newAcv >= plan.quotaCents ? plan.bonusCents : 0n;
    return { ...base, plan: planView(plan), sales, meetings: [], pendingSales: won.length - sales.length, summary: { newAcvCents: newAcv.toString(), commissionCents: commission.toString(), bonusCents: bonus.toString(), totalCents: (plan.fixedCents + commission + bonus).toString(), eligibleCents: sales.reduce((sum, s) => sum + BigInt(s.eligibleCents), 0n).toString(), meetingCount: 0, saleCount: sales.length } };
  }
  function planView(plan: Awaited<ReturnType<typeof database.otePlan.findFirstOrThrow>>) {
    return { label: plan.label, role: plan.role, effectiveMonth: plan.effectiveMonth, fixedCents: plan.fixedCents.toString(), quotaCents: plan.quotaCents.toString(), bonusCents: plan.bonusCents.toString(), meetingQuota: plan.meetingQuota, salesQuota: plan.salesQuota, oteCents: expectedOte(plan).toString() };
  }
  async function administration(context: AuthenticatedContext, raw: unknown = {}) {
    await assertAdmin(context);
    const range = await period(context, raw);
    const dateFilter = { gte: range.from, lt: range.to, lte: now() };
    const [members, plans, sales, facts, meetings, qualifications] = await Promise.all([
      database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, user: { select: { displayName: true } } }, orderBy: { user: { displayName: "asc" } } }),
      database.otePlan.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { effectiveMonth: "desc" } }),
      database.opportunity.findMany({ where: { workspaceId: context.workspaceId, status: "WON", deletedAt: null, closedAt: dateFilter, currency: "BRL" }, select: { id: true, name: true, ownerMemberId: true, mrrCents: true, tcvCents: true, closedAt: true }, orderBy: [{ closedAt: "asc" }, { id: "asc" }] }),
      database.oteSale.findMany({ where: { workspaceId: context.workspaceId } }),
      database.meeting.findMany({ where: { workspaceId: context.workspaceId, status: "COMPLETED", deletedAt: null, completedAt: dateFilter }, select: { id: true, title: true, completedAt: true }, orderBy: { completedAt: "asc" } }),
      database.oteMeeting.findMany({ where: { workspaceId: context.workspaceId } }),
    ]);
    return { month: range.month, members: members.map((m) => ({ id: m.id, name: m.user.displayName })), plans: plans.map((p) => ({ ...planView(p), id: p.id, memberId: p.memberId, revision: p.revision })), sales: sales.map((s) => ({ id: s.id, name: s.name, sellerMemberId: s.ownerMemberId, suggestedAcvCents: (s.mrrCents > 0n ? s.mrrCents * 12n : s.tcvCents).toString(), fact: facts.find((f) => f.opportunityId === s.id) ? serializeFact(facts.find((f) => f.opportunityId === s.id)!) : null })), meetings: meetings.map((m) => ({ id: m.id, title: m.title, date: m.completedAt!.toISOString(), fact: qualifications.find((q) => q.meetingId === m.id) ?? null })) };
  }
  function serializeFact(fact: Awaited<ReturnType<typeof database.oteSale.findFirstOrThrow>>) { return { ...fact, acvCents: fact.acvCents.toString() }; }
  async function command(context: AuthenticatedContext, raw: unknown) {
    await assertAdmin(context);
    const input = oteCommandSchema.parse(raw);
    return database.$transaction(async (tx) => {
      // Serialize administrative edits per workspace, including first inserts.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ote:${context.workspaceId}`}, 0))`;
      const memberId = input.action === "SAVE_PLAN" ? input.memberId : input.sdrMemberId;
      if (memberId && !await tx.workspaceMember.findFirst({ where: { id: memberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true } })) invalid("Pessoa não encontrada nesta empresa.");
      const common = { workspaceId: context.workspaceId, updatedByActorId: context.actorId, updatedAt: now() };
      let entityId: string;
      if (input.action === "SAVE_PLAN") {
        const key = { workspaceId_memberId_effectiveMonth: { workspaceId: context.workspaceId, memberId: input.memberId, effectiveMonth: input.effectiveMonth } };
        const current = await tx.otePlan.findUnique({ where: key });
        if ((current?.revision ?? 0) !== input.expectedRevision) conflict();
        const data = { ...common, memberId: input.memberId, effectiveMonth: input.effectiveMonth, label: input.label, role: input.role, meetingQuota: input.meetingQuota, salesQuota: input.salesQuota, fixedCents: BigInt(input.fixedCents), quotaCents: BigInt(input.quotaCents), bonusCents: BigInt(input.bonusCents) };
        entityId = (current ? await tx.otePlan.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 } } }) : await tx.otePlan.create({ data })).id;
      } else if (input.action === "CLASSIFY_SALE") {
        const sale = await tx.opportunity.findFirst({ where: { id: input.opportunityId, workspaceId: context.workspaceId, status: "WON", deletedAt: null, currency: "BRL", closedAt: { not: null, lte: now() } }, select: { ownerMemberId: true } });
        if (!sale) invalid("Selecione uma venda ganha válida desta empresa.");
        if (isNewAcv(input.kind) && BigInt(input.acvCents) === 0n) invalid("Contrato anual exige ACV positivo.");
        const key = { workspaceId_opportunityId: { workspaceId: context.workspaceId, opportunityId: input.opportunityId } };
        const current = await tx.oteSale.findUnique({ where: key });
        if ((current?.revision ?? 0) !== input.expectedRevision) conflict();
        const data = { ...common, opportunityId: input.opportunityId, kind: input.kind, selfSourced: input.selfSourced, sdrMemberId: input.sdrMemberId, evidence: input.evidence, sellerMemberId: sale.ownerMemberId, acvCents: BigInt(input.acvCents) };
        entityId = (current ? await tx.oteSale.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 } } }) : await tx.oteSale.create({ data })).id;
      } else {
        if (!await tx.meeting.findFirst({ where: { id: input.meetingId, workspaceId: context.workspaceId, status: "COMPLETED", deletedAt: null, completedAt: { not: null, lte: now() } }, select: { id: true } })) invalid("A reunião precisa estar realizada nesta empresa.");
        const key = { workspaceId_meetingId: { workspaceId: context.workspaceId, meetingId: input.meetingId } };
        const current = await tx.oteMeeting.findUnique({ where: key });
        if ((current?.revision ?? 0) !== input.expectedRevision) conflict();
        const data = { ...common, meetingId: input.meetingId, sdrMemberId: input.sdrMemberId, qualified: input.qualified, evidence: input.evidence };
        entityId = (current ? await tx.oteMeeting.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 } } }) : await tx.oteMeeting.create({ data })).id;
      }
      // Salary values stay out of the broadly readable audit payload.
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `ote.${input.action.toLowerCase()}`, entityType: "Ote", entityId, changes: { action: input.action }, metadata: { revision: input.expectedRevision + 1 } } });
      return { id: entityId };
    });
  }
  return { screen, administration, command };
}
let service: ReturnType<typeof createOteService> | undefined;
export function getOteService() { return service ??= createOteService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); }
export type OteScreen = Awaited<ReturnType<ReturnType<typeof createOteService>["screen"]>>;
export type OteAdministration = Awaited<ReturnType<ReturnType<typeof createOteService>["administration"]>>;
