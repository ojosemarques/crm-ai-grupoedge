import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { firstDateOfNextMonth, resolveCloserReleaseDates } from "@/modules/finance/domain/closer-release-calendar";
import { addLocalDays, workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";
import { readSdrAdvertisingFacts } from "./sdr-advertising-facts";

type Period = { kind: "DAY" | "WEEK" | "MONTH"; from: string; to: string };
const periodKey = (kind: string, from: string) => `${kind}:${from}`;
const dateColumn = (date: Date) => date.toISOString().slice(0, 10);
const mondayOf = (day: string) => addLocalDays(day, -((new Date(day).getUTCDay() + 6) % 7));

async function readMissingPeriods(
  tx: Prisma.TransactionClient, workspaceId: string, memberId: string, firstOn: string, today: string,
  regular: readonly Period[], hasPlan: (day: string) => boolean,
) {
  const closed = await tx.sdrAdvertisingSnapshot.findMany({
    where: { workspaceId, memberId, facts: { path: ["closed"], equals: true } },
    distinct: ["periodKind", "periodStartOn"],
    select: { periodKind: true, periodStartOn: true },
  });
  const covered = new Set([
    ...closed.map((period) => periodKey(period.periodKind, dateColumn(period.periodStartOn))),
    ...regular.map((period) => periodKey(period.kind, period.from)),
  ]);
  const missing: Period[] = [];
  const monthStart = `${firstOn.slice(0, 7)}-01`;
  const weekStart = mondayOf(firstOn);
  for (let day = weekStart < monthStart ? weekStart : monthStart; day < today && missing.length < 4; day = addLocalDays(day, 1)) {
    const periods: Period[] = [];
    if (day.endsWith("-01")) periods.push({ kind: "MONTH", from: day, to: firstDateOfNextMonth(day.slice(0, 7)) });
    if (mondayOf(day) === day) periods.push({ kind: "WEEK", from: day, to: addLocalDays(day, 7) });
    periods.push({ kind: "DAY", from: day, to: addLocalDays(day, 1) });
    for (const period of periods) {
      const lastOn = addLocalDays(period.to, -1);
      if (lastOn >= firstOn && period.to <= today && hasPlan(lastOn) && !covered.has(periodKey(period.kind, period.from))) {
        missing.push(period);
      }
    }
  }
  return missing.slice(0, 4);
}

export async function reconcileSdrAdvertisingInTransaction(
  tx: Prisma.TransactionClient, workspaceId: string, timeZone: string, now: Date,
  requested?: { month: string; memberId: string },
) {
  const today = workspaceDateAt(now, timeZone);
  const yesterday = addLocalDays(today, -1);
  const monday = mondayOf(today);
  const month = `${today.slice(0, 7)}-01`;
  const previousMonth = `${addLocalDays(month, -1).slice(0, 7)}-01`;
  const [policies, plans] = await Promise.all([
    tx.commercialCompensationPolicy.findMany({ where: { workspaceId, effectiveDate: { lte: new Date(today) } }, orderBy: { effectiveDate: "desc" } }),
    tx.otePlan.findMany({
      where: { workspaceId, ...(requested ? { memberId: requested.memberId } : {}), effectiveMonth: { lte: today.slice(0, 7) } },
      orderBy: { effectiveMonth: "desc" },
    }),
  ]);
  const members = new Set(plans.filter((plan) => plan.role === "SDR" && plan.advertisingBand100Cents !== null).map((plan) => plan.memberId));
  if (!members.size || !policies.length) return false;
  const regularPeriods: Period[] = requested ? [{ kind: "MONTH", from: `${requested.month}-01`, to: firstDateOfNextMonth(requested.month) }] : [
    { kind: "DAY", from: yesterday, to: today },
    { kind: "DAY", from: today, to: addLocalDays(today, 1) },
    { kind: "WEEK", from: addLocalDays(monday, -7), to: monday },
    { kind: "WEEK", from: monday, to: addLocalDays(monday, 7) },
    { kind: "MONTH", from: previousMonth, to: month },
    { kind: "MONTH", from: month, to: firstDateOfNextMonth(month.slice(0, 7)) },
  ];
  const selectPlan = (memberId: string, day: string) => plans.find((plan) => plan.memberId === memberId && plan.effectiveMonth <= day.slice(0, 7));
  const hasAdvertising = (plan: ReturnType<typeof selectPlan>) => plan?.role === "SDR" && plan.advertisingBand60Cents !== null &&
    plan.advertisingBand80Cents !== null && plan.advertisingBand100Cents !== null && plan.advertisingBonusCents !== null;
  const firstPolicyOn = dateColumn(policies.at(-1)!.effectiveDate);
  const auditScopes: { memberId: string; periods: Period[] }[] = [];
  for (const memberId of members) {
    const firstPlan = plans.filter((plan) => plan.memberId === memberId && hasAdvertising(plan)).at(-1);
    if (!firstPlan) continue;
    const firstPlanOn = `${firstPlan.effectiveMonth}-01`;
    const firstOn = firstPlanOn > firstPolicyOn ? firstPlanOn : firstPolicyOn;
    const missing = requested ? [] : await readMissingPeriods(tx, workspaceId, memberId, firstOn, today,
      regularPeriods, (day) => hasAdvertising(selectPlan(memberId, day)));
    auditScopes.push({ memberId, periods: [...missing, ...regularPeriods] });
  }
  let evaluated = false;
  for (const { memberId, periods } of auditScopes) for (const period of periods) {
    const lastOn = addLocalDays(period.to, -1);
    const plan = selectPlan(memberId, lastOn);
    const policy = policies.find((row) => row.effectiveDate <= new Date(lastOn));
    if (!policy || plan?.role !== "SDR" || plan.advertisingBand60Cents === null || plan.advertisingBand80Cents === null ||
      plan.advertisingBand100Cents === null || plan.advertisingBonusCents === null) continue;
    const effectiveOn = dateColumn(policy.effectiveDate);
    const cohortFrom = period.from > effectiveOn ? period.from : effectiveOn;
    if (cohortFrom > today) continue;
    const from = workspaceDayRange(cohortFrom, timeZone).start;
    const to = workspaceDayRange(period.to, timeZone).start;
    const closed = to <= now;
    const through = closed ? new Date(to.getTime() - 1) : now;
    const snapshot = await readSdrAdvertisingFacts(tx, { workspaceId, memberId, from, to, through, recordedThrough: now });
    const facts = { ...snapshot, closed, cohortFrom, policyVersion: policy.version, planId: plan.id, planRevision: plan.revision };
    const fingerprint = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
    const scope = { workspaceId, memberId, periodKind: period.kind, periodStartOn: new Date(period.from) };
    const previous = await tx.sdrAdvertisingSnapshot.findFirst({ where: scope, orderBy: { revision: "desc" } });
    const revision = previous?.fingerprint === fingerprint ? previous.revision : (previous?.revision ?? 0) + 1;
    if (revision !== previous?.revision) await tx.sdrAdvertisingSnapshot.create({ data: {
      ...scope, policyVersion: policy.version, periodEndOn: new Date(period.to), revision, fingerprint, facts, evaluatedAt: now,
    } });
    if (!closed || period.kind !== "MONTH") continue;
    evaluated = true;

    const band = snapshot.attainment.band;
    const amount = band === 100 ? plan.advertisingBand100Cents : band === 80 ? plan.advertisingBand80Cents
      : band === 60 ? plan.advertisingBand60Cents : 0n;
    const calendar = policy.calendarVerifiedThrough ? {
      throughOn: policy.calendarVerifiedThrough.toISOString().slice(0, 10),
      holidays: new Set(policy.calendarHolidays.map((date) => date.toISOString().slice(0, 10))),
    } : null;
    const dates = resolveCloserReleaseDates({ cycle: "MONTHLY", milestoneOn: period.to, evaluatedOn: today, timeZone, calendar });
    for (const [kind, amountCents] of [["SDR_COMMISSION", amount], ["SDR_BONUS", band === 100 ? plan.advertisingBonusCents : 0n]] as const) {
      const competenceMonth = period.from.slice(0, 7);
      const obligationKey = `sdr:${kind}:${memberId}:${competenceMonth}`;
      const where = { workspaceId_obligationKey: { workspaceId, obligationKey } };
      const existing = await tx.commercialCompensationObligation.findUnique({ where });
      const scheduleChanged = existing?.eligibleAt && (
        existing.eligibleAt.getTime() !== dates.eligibleAt?.getTime() || existing.dueOn?.getTime() !== dates.dueOn?.getTime()
      );
      if (existing && (existing.amountCents !== amountCents || band === null || existing.policyVersion !== policy.version || scheduleChanged)) {
        const reason = "A apuração de Anúncios mudou após o fechamento.";
        const sourceEventKey = `sdr-snapshot:${revision}`;
        await tx.commercialCompensationReview.upsert({
          where: { workspaceId_obligationKey_sourceEventKey: { workspaceId, obligationKey, sourceEventKey } },
          create: { workspaceId, obligationKey, sourceEventKey, reason }, update: {},
        });
        if (existing.status !== "PAID" && existing.status !== "REVIEW") {
          await tx.commercialCompensationObligation.update({ where, data: { status: "REVIEW", reason, revision: { increment: 1 } } });
        }
        continue;
      }
      if (amountCents <= 0n) continue;
      if (!existing) {
        const lateChange = previous?.facts && typeof previous.facts === "object" && !Array.isArray(previous.facts) && previous.facts.closed === true;
        await tx.commercialCompensationObligation.create({ data: {
          workspaceId, obligationKey, policyVersion: policy.version, sellerMemberId: memberId, kind, competenceMonth,
          amountCents, milestoneOn: new Date(period.to), eligibleAt: lateChange ? null : dates.eligibleAt, dueOn: lateChange ? null : dates.dueOn,
          status: lateChange ? "REVIEW" : dates.eligibleAt ? "ELIGIBLE" : "PENDING",
          reason: lateChange ? "Evidência nova após o fechamento da apuração de Anúncios." : dates.eligibleAt ? null : "Calendário de pagamento sem cobertura verificada.",
          sourceFacts: { snapshotRevision: revision, band },
        } });
      } else if (existing.status === "PENDING" && dates.eligibleAt) {
        await tx.commercialCompensationObligation.update({ where, data: {
          status: "ELIGIBLE", reason: null, eligibleAt: dates.eligibleAt, dueOn: dates.dueOn, revision: { increment: 1 },
        } });
      }
    }
  }
  return evaluated;
}
