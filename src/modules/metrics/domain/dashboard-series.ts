import type {
  DashboardPeriodInterval,
  DashboardTimeSeries,
  DashboardTimeSeriesGranularity,
  DashboardTimeSeriesPoint,
} from "@/modules/metrics/domain/dashboard-contracts";
import { durationStatistics } from "@/modules/metrics/domain/metric-math";
import type { IntegratedActivityFact, MetricsOverview } from "@/modules/metrics/domain/metrics-contracts";
import {
  addLocalDays,
  workspaceDateAt,
  workspaceDayRange,
} from "@/shared/core/time/workspace-time";

type Bucket = Readonly<{ bucket: string; from: Date; to: Date }>;
type TimedRecord = Readonly<{ occurredAt: string }>;

function chooseGranularity(from: Date, to: Date): DashboardTimeSeriesGranularity {
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  if (hours <= 48) return "HOUR";
  if (hours <= 24 * 120) return "DAY";
  return "WEEK";
}

function localHourLabel(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).flatMap((part) => part.type === "literal" ? [] : [[part.type, part.value]]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
}

function makeBuckets(period: DashboardPeriodInterval): readonly Bucket[] {
  const from = new Date(period.from);
  const to = new Date(period.to);
  const granularity = chooseGranularity(from, to);
  const result: Bucket[] = [];
  let cursor = from;
  let localDate = workspaceDateAt(from, period.timeZone);
  while (cursor < to) {
    let candidate: Date;
    if (granularity === "HOUR") {
      candidate = new Date(cursor.getTime() + 3_600_000);
    } else {
      const days = granularity === "DAY" ? 1 : 7;
      localDate = addLocalDays(localDate, days);
      candidate = workspaceDayRange(localDate, period.timeZone).start;
    }
    const end = candidate < to ? candidate : to;
    result.push(Object.freeze({
      bucket: granularity === "HOUR"
        ? localHourLabel(cursor, period.timeZone)
        : workspaceDateAt(cursor, period.timeZone),
      from: cursor,
      to: end,
    }));
    cursor = end;
  }
  return Object.freeze(result);
}

function inBucket(occurredAt: string, bucket: Bucket): boolean {
  const time = Date.parse(occurredAt);
  return time >= bucket.from.getTime() && time < bucket.to.getTime();
}

function countPoints(buckets: readonly Bucket[], rows: readonly TimedRecord[]): readonly DashboardTimeSeriesPoint[] {
  return Object.freeze(buckets.map((bucket) => {
    const value = rows.filter((row) => inBucket(row.occurredAt, bucket)).length;
    return Object.freeze({
      bucket: bucket.bucket,
      from: bucket.from.toISOString(),
      to: bucket.to.toISOString(),
      value,
      numerator: value,
      denominator: null,
    });
  }));
}

function moneyPoints(
  buckets: readonly Bucket[],
  rows: readonly (TimedRecord & Readonly<{ cents: string }>)[],
): readonly DashboardTimeSeriesPoint[] {
  return Object.freeze(buckets.map((bucket) => {
    const value = rows
      .filter((row) => inBucket(row.occurredAt, bucket))
      .reduce((sum, row) => sum + BigInt(row.cents), 0n)
      .toString();
    return Object.freeze({
      bucket: bucket.bucket,
      from: bucket.from.toISOString(),
      to: bucket.to.toISOString(),
      value,
      numerator: value,
      denominator: null,
    });
  }));
}

function slaPoints(
  buckets: readonly Bucket[],
  rows: readonly Readonly<{ receivedAt: string; humanSeconds: number | null }>[],
  percentile: "medianSeconds" | "p90Seconds",
): readonly DashboardTimeSeriesPoint[] {
  return Object.freeze(buckets.map((bucket) => {
    const samples = rows
      .filter((row) => inBucket(row.receivedAt, bucket))
      .flatMap((row) => row.humanSeconds === null ? [] : [row.humanSeconds]);
    const statistics = durationStatistics(samples);
    return Object.freeze({
      bucket: bucket.bucket,
      from: bucket.from.toISOString(),
      to: bucket.to.toISOString(),
      value: statistics[percentile],
      numerator: samples.length,
      denominator: rows.filter((row) => inBucket(row.receivedAt, bucket)).length,
    });
  }));
}

function conversionPoints(
  buckets: readonly Bucket[],
  receipts: MetricsOverview["evidence"]["leadReceipts"],
  wonLeadIds: ReadonlySet<string>,
): readonly DashboardTimeSeriesPoint[] {
  return Object.freeze(buckets.map((bucket) => {
    const bucketReceipts = receipts.filter((row) => inBucket(row.occurredAt, bucket));
    const numerator = bucketReceipts.filter((row) => wonLeadIds.has(row.leadId)).length;
    const denominator = bucketReceipts.length;
    return Object.freeze({
      bucket: bucket.bucket,
      from: bucket.from.toISOString(),
      to: bucket.to.toISOString(),
      value: denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 100,
      numerator,
      denominator,
    });
  }));
}

export function buildDashboardTimeSeries(
  overview: MetricsOverview,
  period: DashboardPeriodInterval,
): readonly DashboardTimeSeries[] {
  const buckets = makeBuckets(period);
  const granularity = chooseGranularity(new Date(period.from), new Date(period.to));
  const evidence = overview.evidence;
  const countSeries = (
    id: string,
    label: string,
    rows: readonly TimedRecord[],
    formula: string,
    drilldownId: string,
  ): DashboardTimeSeries => Object.freeze({
    id, label, kind: "COUNT" as const, granularity, aggregation: "SUM" as const,
    formula, drilldownId, points: countPoints(buckets, rows),
  });
  const result: DashboardTimeSeries[] = [
    countSeries("leads", "Leads recebidos", evidence.leadReceipts, "novas identidades por submittedAt", "kpi.leads"),
    countSeries("calls", "Ligações realizadas", [], "ligações outbound registradas no período", "integrated.outreach.calls_attempted"),
    countSeries("attempts", "Primeiras tentativas", evidence.firstAttempts, "primeiras tentativas humanas por firstHumanAttemptAt", "kpi.attempts"),
    countSeries("connected", "Leads conectados", evidence.firstConnections, "primeiras conexões por firstConnectedAt", "kpi.connected"),
    countSeries("qualified", "Qualificados", evidence.qualifications, "primeira entrada em Qualificado da coorte", "kpi.qualified"),
    countSeries("scheduled", "Reuniões agendadas", evidence.scheduledMeetings, "primeiro agendamento por lead qualificado", "kpi.scheduled"),
    countSeries("held", "Reuniões realizadas", evidence.heldMeetings, "último estado COMPLETED no corte", "kpi.held"),
    countSeries("no-show", "No-shows", evidence.noShowMeetings, "último estado NO_SHOW no corte", "kpi.no-show"),
    countSeries("opportunities", "Oportunidades", evidence.opportunitiesCreated, "oportunidades criadas por createdAt", "kpi.opportunities"),
    countSeries("proposals", "Oportunidades em Proposta", evidence.proposals, "primeira entrada da oportunidade em Proposta no período", "kpi.proposals"),
    countSeries("sales", "Vendas", evidence.periodWins, "ganhos vigentes por occurredAt", "kpi.sales"),
    countSeries("losses", "Perdas", evidence.periodLosses, "perdas vigentes por occurredAt", "full-funnel.lost"),
    countSeries("disqualified", "Desqualificados", evidence.disqualifications, "desqualificações vigentes por enteredAt", "full-funnel.disqualified"),
    Object.freeze({
      id: "revenue", label: "Receita", kind: "MONEY" as const, granularity, aggregation: "SUM" as const,
      formula: "soma de amountCents dos ganhos vigentes", drilldownId: "kpi.revenue",
      points: moneyPoints(buckets, evidence.periodWins.map((row) => ({ occurredAt: row.occurredAt, cents: row.amountCents }))),
    }),
    Object.freeze({
      id: "mrr", label: "MRR", kind: "MONEY" as const, granularity, aggregation: "SUM" as const,
      formula: "soma de mrrCents dos ganhos vigentes", drilldownId: "kpi.mrr",
      points: moneyPoints(buckets, evidence.periodWins.map((row) => ({ occurredAt: row.occurredAt, cents: row.mrrCents }))),
    }),
    Object.freeze({
      id: "sla-median", label: "Mediana do SLA humano", kind: "DURATION" as const, granularity, aggregation: "MEDIAN" as const,
      formula: "mediana de firstHumanAttemptSeconds por bucket de recebimento", drilldownId: "kpi.sla",
      points: slaPoints(buckets, evidence.slaCycles, "medianSeconds"),
    }),
    Object.freeze({
      id: "sla-p90", label: "P90 do SLA humano", kind: "DURATION" as const, granularity, aggregation: "P90" as const,
      formula: "P90 de firstHumanAttemptSeconds por bucket de recebimento", drilldownId: "kpi.sla",
      points: slaPoints(buckets, evidence.slaCycles, "p90Seconds"),
    }),
    Object.freeze({
      id: "lead-to-sale", label: "Conversão lead → venda", kind: "RATE" as const, granularity, aggregation: "RATE" as const,
      formula: "leads recebidos no bucket com ganho vigente no corte / leads recebidos no bucket",
      drilldownId: "comparison.current.lead-to-sale",
      points: conversionPoints(buckets, evidence.leadReceipts, new Set(evidence.wonLeadIdsAtCut)),
    }),
  ];
  return Object.freeze(result);
}

export function mergeIntegratedActivitySeries(
  series: readonly DashboardTimeSeries[],
  facts: readonly IntegratedActivityFact[],
): readonly DashboardTimeSeries[] {
  const definitions = {
    leads: { eventTypes: ["LEAD_CREATED"], label: "Leads recebidos", formula: "identidades de lead criadas no período" },
    calls: { eventTypes: ["CALL_ATTEMPTED"], label: "Ligações realizadas", formula: "tentativas outbound registradas no período" },
    connected: { eventTypes: ["CALL_CONNECTED", "INBOUND_MESSAGE_RECEIVED"], label: "Leads conectados", formula: "leads distintos com ligação atendida ou mensagem inbound em cada intervalo", distinctLead: true, distinctLeadPerBucket: true },
    qualified: { eventTypes: ["LEAD_QUALIFIED"], label: "Qualificados", formula: "leads distintos com qualificação registrada no período", distinctLead: true },
    scheduled: { eventTypes: ["MEETING_SCHEDULED"], label: "Reuniões agendadas", formula: "reuniões criadas na agenda no período", sourceEntityType: "MeetingHistory" },
    proposals: { eventTypes: ["PROPOSAL_REACHED"], label: "Propostas", formula: "ofertas comerciais registradas no período", sourceEntityType: "Offer" },
    sales: { eventTypes: ["SALE_WON"], label: "Vendas", formula: "ganhos registrados no período" },
    revenue: { eventTypes: ["SALE_WON"], label: "Receita", formula: "valor vendido nos ganhos registrados no período", money: true },
  } as const;
  return Object.freeze(series.map((item) => {
    const definition = definitions[item.id as keyof typeof definitions];
    if (!definition) return item;
    const related = facts.filter((fact) => definition.eventTypes.some((eventType) => eventType === fact.eventType));
    if (facts.length === 0) return item;
    let eligible = related.filter((fact) => !("sourceEntityType" in definition) || fact.sourceEntityType === definition.sourceEntityType);
    if ("distinctLead" in definition) {
      const occurrences = new Map<string, { balance: number; fact: IntegratedActivityFact }>();
      for (const fact of eligible) {
        if (!fact.leadId) continue;
        const key = `${fact.eventType}:${fact.leadId}:${fact.occurredAt}`;
        const previous = occurrences.get(key);
        occurrences.set(key, { balance: (previous?.balance ?? 0) + fact.quantity, fact: previous?.fact ?? fact });
      }
      const firstActiveByLead = new Map<string, IntegratedActivityFact>();
      for (const { balance, fact } of occurrences.values()) {
        if (balance <= 0) continue;
        const bucket = "distinctLeadPerBucket" in definition
          ? item.points.find((point) => fact.occurredAt >= point.from && fact.occurredAt < point.to)?.from
          : null;
        if ("distinctLeadPerBucket" in definition && !bucket) continue;
        const key = bucket ? `${bucket}:${fact.leadId}` : fact.leadId!;
        const first = firstActiveByLead.get(key);
        if (!first || fact.occurredAt < first.occurredAt) firstActiveByLead.set(key, fact);
      }
      eligible = [...firstActiveByLead.values()];
    }
    const points = item.points.map((point) => {
      const matching = eligible.filter((fact) => fact.occurredAt >= point.from && fact.occurredAt < point.to);
      const value = "money" in definition
        ? matching.reduce((sum, fact) => sum + BigInt(fact.valueCents ?? "0"), 0n).toString()
        : matching.reduce((sum, fact) => sum + ("distinctLead" in definition ? 1 : fact.quantity), 0);
      return Object.freeze({ ...point, value, numerator: value });
    });
    return Object.freeze({ ...item, label: definition.label, formula: definition.formula, points: Object.freeze(points) });
  }));
}

export const dashboardTimeSeriesRules = Object.freeze({
  hourlyMaximumHours: 48,
  dailyMaximumDays: 120,
  maximumPeriodDays: 366,
});
