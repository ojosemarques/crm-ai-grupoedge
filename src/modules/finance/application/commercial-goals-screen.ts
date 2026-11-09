import type { PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { projectCloserMonth } from "@/modules/finance/domain/closer-compensation";
import { firstDateOfNextMonth } from "@/modules/finance/domain/closer-release-calendar";
import { addLocalDays, workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";
import { readCloserCompensationFacts } from "./closer-compensation-facts";
import { readCommercialCompensationScreen } from "./commercial-compensation-screen";
import { readSdrAdvertisingFacts } from "./sdr-advertising-facts";

const countsSchema = z.object({
  leads: z.number(), bookedLeads: z.number(), eligibleMeetings: z.number(),
  heldMeetings: z.number(), pendingMeetings: z.number(), missingEvidence: z.number(),
});
const snapshotView = z.object({
  counts: countsSchema,
  attainment: z.object({
    coverage: z.enum(["READY", "NO_BASE", "REVIEW"]), band: z.number().nullable(),
    attainmentBps: z.number().nullable(), progressBps: z.number().nullable(),
  }),
});
const sourceView = z.object({
  d0: z.string().optional(),
  tiers: z.array(z.object({ basisCents: z.string(), rateBps: z.string() })).optional(),
});

export async function readCommercialGoalsScreen(database: PrismaClient, input: {
  workspaceId: string; month: string; now: Date; memberId?: string;
}) {
  const { workspaceId, month, now, memberId } = input;
  const { timeZone } = await database.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timeZone: true } });
  const fromOn = `${month}-01`;
  const toOn = firstDateOfNextMonth(month);
  const from = workspaceDayRange(fromOn, timeZone).start;
  const to = workspaceDayRange(toOn, timeZone).start;
  const through = new Date(Math.min(now.getTime(), to.getTime() - 1));
  const today = workspaceDateAt(now, timeZone);
  const [policy, titles] = await Promise.all([
    database.commercialCompensationPolicy.findFirst({
      where: { workspaceId, effectiveDate: { lte: new Date(workspaceDateAt(through, timeZone)) } }, orderBy: { effectiveDate: "desc" },
    }),
    readCommercialCompensationScreen(database, workspaceId, from, to, timeZone, memberId ? { sellerId: memberId } : {}),
  ]);
  const historicalSellers = new Set(titles.filter((title) => title.kind === "LEGACY_STAGE").map((title) => title.sellerId));
  if (!policy && !historicalSellers.size) return { month, timeZone, active: false, people: [] };
  const plans = await database.otePlan.findMany({
    where: { workspaceId, ...(memberId ? { memberId } : {}), effectiveMonth: { lte: month } },
    orderBy: [{ effectiveMonth: "desc" }, { id: "asc" }],
  });
  const effectiveOn = policy?.effectiveDate.toISOString().slice(0, 10);
  const selectedPlans = [...new Map([...plans].reverse().map((plan) => [plan.memberId, plan])).values()]
    .filter((plan) => plan.role === "CLOSER" ? Boolean(policy) || historicalSellers.has(plan.memberId)
      : plan.role === "SDR" && Boolean(policy) && plan.advertisingBand100Cents !== null);
  const [members, closer] = await Promise.all([
    database.workspaceMember.findMany({
      where: { workspaceId, id: { in: selectedPlans.map((plan) => plan.memberId) } },
      select: { id: true, user: { select: { displayName: true } } },
    }),
    policy && selectedPlans.some((plan) => plan.role === "CLOSER") ? readCloserCompensationFacts(database, workspaceId, now) : null,
  ]);
  const legacy = closer ? await database.commission.findMany({
    where: { workspaceId, opportunityId: { in: closer.sales.map((sale) => sale.opportunityId) } },
    select: { opportunityId: true }, distinct: ["opportunityId"],
  }) : [];
  const legacySales = new Set(legacy.map((sale) => sale.opportunityId));
  const names = new Map(members.map((member) => [member.id, member.user.displayName]));
  const people = await Promise.all(selectedPlans.map(async (plan) => {
    const ownTitles = titles.filter((title) => title.sellerId === plan.memberId);
    const generated = ownTitles.filter((title) => title.generatedInPeriod);
    const person = {
      memberId: plan.memberId, name: names.get(plan.memberId) ?? plan.label,
      label: plan.label, fixedCents: plan.fixedCents.toString(),
      commissionCents: generated.filter((title) => title.kind.includes("COMMISSION") || title.kind === "LEGACY_STAGE").reduce((sum, title) => sum + BigInt(title.amountCents), 0n).toString(),
      bonusCents: generated.filter((title) => title.kind.includes("BONUS")).reduce((sum, title) => sum + BigInt(title.amountCents), 0n).toString(),
      periodPaidCents: ownTitles.reduce((sum, title) => sum + BigInt(title.periodPaidCents), 0n).toString(),
      titles: ownTitles.map((title) => ({
        key: title.key, kind: title.kind, status: title.status, competenceMonth: title.competenceMonth,
        amountCents: title.amountCents, paidCents: title.paidCents, balanceCents: title.balanceCents,
        dueOn: title.dueOn, milestoneOn: title.milestoneOn, eligibleAt: title.eligibleAt,
        reason: title.reason, opportunityName: title.opportunityName,
        facts: sourceView.safeParse(title.sourceFacts).data ?? null,
      })),
    };
    if (plan.role === "SDR") {
      const monthIsOpen = month === today.slice(0, 7);
      const monday = addLocalDays(today, -((new Date(today).getUTCDay() + 6) % 7));
      const periods = [
        { kind: "MONTH", fromOn, toOn },
        ...(monthIsOpen ? [
          { kind: "DAY", fromOn: today, toOn: addLocalDays(today, 1) },
          { kind: "WEEK", fromOn: monday, toOn: addLocalDays(monday, 7) },
        ] : []),
      ];
      const factsByStart = new Map<string, ReturnType<typeof readSdrAdvertisingFacts>>();
      const metrics = await Promise.all(periods.map(async (period) => {
        const periodStartOn = new Date(period.fromOn);
        const snapshot = await database.sdrAdvertisingSnapshot.findFirst({
          where: { workspaceId, memberId: plan.memberId, periodKind: period.kind, periodStartOn }, orderBy: { revision: "desc" },
          select: { revision: true, facts: true, evaluatedAt: true },
        });
        if (!monthIsOpen) return {
          ...period, facts: snapshotView.safeParse(snapshot?.facts).data ?? null, evaluatedAt: snapshot?.evaluatedAt.toISOString() ?? null, revision: snapshot?.revision ?? null,
        };
        const cohortFrom = effectiveOn && period.fromOn < effectiveOn ? effectiveOn : period.fromOn;
        const pendingFacts = factsByStart.get(cohortFrom) ?? readSdrAdvertisingFacts(database, {
          workspaceId, memberId: plan.memberId, from: workspaceDayRange(cohortFrom, timeZone).start,
          to: workspaceDayRange(period.toOn, timeZone).start, through: now,
        });
        factsByStart.set(cohortFrom, pendingFacts);
        const facts = await pendingFacts;
        return { ...period, facts: { counts: facts.counts, attainment: facts.attainment }, evaluatedAt: now.toISOString(), revision: snapshot?.revision ?? null };
      }));
      return {
        ...person, role: "SDR" as const, metrics,
        targetOteCents: (plan.fixedCents + (plan.advertisingBand100Cents ?? 0n) + (plan.advertisingBonusCents ?? 0n)).toString(),
      };
    }
    const facts = closer?.sales.filter((sale) => sale.sellerMemberId === plan.memberId && !legacySales.has(sale.opportunityId)) ?? [];
    const ramp = plan.rampMonth === month;
    const goal = !policy || ramp || plan.quotaCents <= 0n ? null : plan.quotaCents;
    const planInput = ramp && plan.rampEvidence?.trim() ? { kind: "RAMP" as const }
      : goal ? { kind: "TARGET" as const, targetCents: goal } : null;
    const projection = projectCloserMonth({
      month, timeZone, plan: planInput,
      sales: facts.flatMap((sale) => sale.confirmation && (sale.d0 || sale.closedOn.slice(0, 7) === month) ? [{
        opportunityId: sale.opportunityId, modality: sale.confirmation.modality, d0: sale.d0,
        acvCents: sale.confirmation.netContractCents, recordedAt: sale.confirmation.confirmedAt,
        selfSourced: sale.confirmation.selfSourced,
        netSettledCents: sale.evidenced.reduce((sum, receipt) => sum + receipt.netCents, 0n),
      }] : []),
    });
    const missingCents = goal && projection.newAcvCents < goal ? goal - projection.newAcvCents : 0n;
    const attainmentBps = goal ? (projection.newAcvCents * 10000n / goal).toString() : null;
    return {
      ...person, role: "CLOSER" as const, ramp, rampVerified: Boolean(plan.rampEvidence?.trim()),
      targetOteCents: goal ? (plan.fixedCents + (goal * 600n + 5000n) / 10000n + plan.bonusCents).toString() : null,
      goalCents: goal?.toString() ?? null, newAcvCents: projection.newAcvCents.toString(),
      pendingAcvCents: projection.pendingAcvCents.toString(), missingCents: missingCents.toString(), attainmentBps,
      pendingSales: facts.filter((sale) => !sale.d0 && sale.closedOn.slice(0, 7) === month).length,
    };
  }));
  return { month, timeZone, active: true, people };
}

export type CommercialGoalsPerson = Awaited<ReturnType<typeof readCommercialGoalsScreen>>["people"][number];
