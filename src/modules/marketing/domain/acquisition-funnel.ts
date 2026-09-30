import { PAYMENT_PROVIDER_KEY } from "@/modules/payments/domain/payment-contracts";

export type FunnelDimension = "source" | "campaign" | "creative" | "utmCampaign" | "utmContent";
type Dimension = Readonly<{ id: string; name: string }> | null;
export type AcquisitionReceipt = Readonly<{
  id: string;
  amountCents: string;
  currency: string;
  invoiceCurrency: string;
  providerKey: string;
  status: string;
  occurredAt: Date;
  reversedAt: Date | null;
}>;

export function summarizeAcquisitionReceipts(payments: readonly AcquisitionReceipt[], start: Date, end: Date) {
  let received = 0n;
  let reversed = 0n;
  let receiptCount = 0;
  let reversalCount = 0;
  let excludedCount = 0;
  const seen = new Set<string>();
  for (const payment of payments) {
    if (seen.has(payment.id)) continue;
    seen.add(payment.id);
    if (payment.providerKey === PAYMENT_PROVIDER_KEY) continue;
    if (payment.currency !== "BRL" || payment.currency !== payment.invoiceCurrency || (payment.status !== "CONFIRMED" && !payment.reversedAt)) { excludedCount += 1; continue; }
    if (payment.occurredAt >= end) continue;
    if (payment.occurredAt >= start) { received += BigInt(payment.amountCents); receiptCount += 1; }
    if (payment.reversedAt && payment.reversedAt >= start && payment.reversedAt < end) { reversed += BigInt(payment.amountCents); reversalCount += 1; }
  }
  return { receivedCents: received.toString(), reversedCents: reversed.toString(), netReceivedCents: (received - reversed).toString(), receiptCount, reversalCount, excludedCount };
}

export type FunnelLead = Readonly<{
  id: string;
  source: Dimension;
  campaign: Dimension;
  creative: Dimension;
  utmCampaign: string | null;
  utmContent: string | null;
  tags: readonly string[];
  meetings: readonly { status: string }[];
  wins: readonly { amountCents: number }[];
  receipts?: ReturnType<typeof summarizeAcquisitionReceipts>;
}>;

function emptyCounts() {
  return { leads: 0, scheduled: 0, completed: 0, noShow: 0, buyers: 0, sales: 0, revenueCents: 0, receivedCents: "0", reversedCents: "0", netReceivedCents: "0", receiptCount: 0, reversalCount: 0, tier1: 0, tier2: 0, tier3: 0, unclassified: 0, representatives: 0 };
}

export function summarizeAcquisitionFunnel(leads: readonly FunnelLead[], dimension: FunnelDimension) {
  const rows = new Map<string, ReturnType<typeof emptyCounts> & { key: string; label: string }>();
  for (const lead of leads) {
    const rawValue = lead[dimension];
    const value = typeof rawValue === "string" ? rawValue.trim() || null : rawValue;
    const key = typeof value === "string" ? `${dimension}:${value}` : value?.id ?? "unattributed";
    const label = typeof value === "string" ? value : value?.name ?? "Não identificado";
    const row = rows.get(key) ?? { key, label, ...emptyCounts() };
    row.leads += 1;
    // Each stage counts people, not meetings; one person may have both a no-show and a completed meeting.
    row.scheduled += Number(lead.meetings.length > 0);
    row.completed += Number(lead.meetings.some((meeting) => meeting.status === "COMPLETED"));
    row.noShow += Number(lead.meetings.some((meeting) => meeting.status === "NO_SHOW"));
    row.buyers += Number(lead.wins.length > 0);
    row.sales += lead.wins.length;
    row.revenueCents += lead.wins.reduce((sum, sale) => sum + sale.amountCents, 0);
    row.receivedCents = (BigInt(row.receivedCents) + BigInt(lead.receipts?.receivedCents ?? "0")).toString();
    row.reversedCents = (BigInt(row.reversedCents) + BigInt(lead.receipts?.reversedCents ?? "0")).toString();
    row.netReceivedCents = (BigInt(row.netReceivedCents) + BigInt(lead.receipts?.netReceivedCents ?? "0")).toString();
    row.receiptCount += lead.receipts?.receiptCount ?? 0;
    row.reversalCount += lead.receipts?.reversalCount ?? 0;
    const tags = new Set(lead.tags.map((tag) => tag.trim().toLowerCase().replace(/[\s_-]+/g, "")));
    const tiers = ([1, 2, 3] as const).filter((tier) => tags.has(`tier${tier}`));
    if (tiers.length === 1) row[`tier${tiers[0]!}`] += 1;
    else row.unclassified += 1;
    row.representatives += Number(tags.has("representante"));
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => right.leads - left.leads || left.label.localeCompare(right.label, "pt-BR"));
}
