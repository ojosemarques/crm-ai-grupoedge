export type AcquisitionJourneyFact = Readonly<{
  leadId: string;
  leadName: string;
  leadCreatedAt: string;
  sourceName: string;
  campaignName: string | null;
  creativeName: string | null;
  entryPoint: string | null;
  meetingId: string | null;
  meetingAt: string | null;
  meetingStatus: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  wonAt: string | null;
  wonValueCents: string;
  invoiceId: string | null;
  receivedAt: string | null;
  receivedCents: string;
}>;

const count = (facts: readonly AcquisitionJourneyFact[], predicate: (fact: AcquisitionJourneyFact) => boolean) => facts.filter(predicate).length;
const bps = (numerator: number, denominator: number) => denominator > 0 ? Math.round(numerator * 10_000 / denominator) : 0;

export function buildAcquisitionJourney(facts: readonly AcquisitionJourneyFact[]) {
  const total = facts.length;
  const stages = [
    { key: "CAMPAIGN", label: "Campanha", count: count(facts, fact => Boolean(fact.campaignName)), detail: "campanha identificada" },
    { key: "CREATIVE", label: "Criativo", count: count(facts, fact => Boolean(fact.creativeName)), detail: "criativo identificado" },
    { key: "ENTRY", label: "Página / WhatsApp", count: count(facts, fact => Boolean(fact.entryPoint)), detail: "ponto de entrada identificado" },
    { key: "LEAD", label: "Lead", count: total, detail: "leads da coorte" },
    { key: "MEETING", label: "Reunião", count: count(facts, fact => Boolean(fact.meetingId)), detail: "leads com reunião" },
    { key: "SALE", label: "Venda", count: count(facts, fact => Boolean(fact.wonAt)), detail: "leads com venda ganha" },
    { key: "RECEIPT", label: "Recebimento", count: count(facts, fact => BigInt(fact.receivedCents) > 0n), detail: "leads com valor recebido" },
  ].map(stage => ({ ...stage, shareBps: bps(stage.count, total) }));

  const campaignMap = new Map<string, AcquisitionJourneyFact[]>();
  for (const fact of facts) {
    const key = fact.campaignName ?? "Sem campanha identificada";
    campaignMap.set(key, [...(campaignMap.get(key) ?? []), fact]);
  }
  const campaigns = [...campaignMap.entries()].map(([name, rows]) => {
    const meetings = count(rows, row => Boolean(row.meetingId));
    const sales = count(rows, row => Boolean(row.wonAt));
    const receipts = count(rows, row => BigInt(row.receivedCents) > 0n);
    const receivedCents = rows.reduce((sum, row) => sum + BigInt(row.receivedCents), 0n);
    return { name, leads: rows.length, meetings, sales, receipts, meetingRateBps: bps(meetings, rows.length), winRateBps: bps(sales, rows.length), receivedCents: receivedCents.toString() };
  }).sort((left, right) => BigInt(right.receivedCents) > BigInt(left.receivedCents) ? 1 : BigInt(right.receivedCents) < BigInt(left.receivedCents) ? -1 : right.leads - left.leads || left.name.localeCompare(right.name));

  const receivedCents = facts.reduce((sum, fact) => sum + BigInt(fact.receivedCents), 0n);
  return {
    stages,
    campaigns,
    rows: [...facts].sort((left, right) => right.leadCreatedAt.localeCompare(left.leadCreatedAt)).slice(0, 100),
    summary: { cohortLeads: total, receivedCents: receivedCents.toString(), traceableReceipts: stages.at(-1)?.count ?? 0 },
  };
}
