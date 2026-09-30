import { describe, expect, it } from "vitest";
import { summarizeAcquisitionFunnel, summarizeAcquisitionReceipts, type AcquisitionReceipt, type FunnelLead } from "./acquisition-funnel";

const lead: FunnelLead = { id: "lead-1", source: { id: "meta", name: "Meta" }, campaign: null, creative: null, utmCampaign: null, utmContent: null, tags: [], meetings: [], wins: [] };

describe("funil comercial por origem", () => {
  it("conta pessoas únicas nas reuniões e separa vendas de compradores", () => {
    const rows = summarizeAcquisitionFunnel([{ ...lead, meetings: [{ status: "COMPLETED" }, { status: "COMPLETED" }, { status: "NO_SHOW" }], wins: [{ amountCents: 2000 }, { amountCents: 1000 }] }], "source");
    expect(rows[0]).toMatchObject({ leads: 1, scheduled: 1, completed: 1, noShow: 1, buyers: 1, sales: 2, revenueCents: 3000 });
  });
  it("não infere no-show de agendamento pendente ou cancelado", () => {
    expect(summarizeAcquisitionFunnel([{ ...lead, meetings: [{ status: "CANCELLED" }, { status: "SCHEDULED" }] }], "campaign")[0]).toMatchObject({ label: "Não identificado", noShow: 0, completed: 0 });
  });
  it("preserva UTMs e campanhas homônimas como dimensões separadas", () => {
    const leads = [{ ...lead, campaign: { id: "a", name: "Campanha" }, utmContent: "Criativo A" }, { ...lead, id: "lead-2", campaign: { id: "b", name: "Campanha" }, utmContent: "Criativo B" }];
    expect(summarizeAcquisitionFunnel(leads, "campaign")).toHaveLength(2);
    expect(summarizeAcquisitionFunnel(leads, "utmContent").map((row) => row.label)).toEqual(["Criativo A", "Criativo B"]);
  });
  it("classifica somente tags explícitas e sinaliza tiers conflitantes", () => {
    const result = summarizeAcquisitionFunnel([{ ...lead, tags: ["Tier 1", "representante"] }, { ...lead, id: "2", tags: ["tier-2", "tier_3"] }], "source");
    expect(result[0]).toMatchObject({ tier1: 1, tier2: 0, tier3: 0, unclassified: 1, representatives: 1 });
  });
});

const periodStart = new Date("2026-09-01T00:00:00Z");
const periodEnd = new Date("2026-10-01T00:00:00Z");
const payment: AcquisitionReceipt = { id: "receipt", amountCents: "10001", currency: "BRL", invoiceCurrency: "BRL", providerKey: "MANUAL_RECEIPT", status: "CONFIRMED", occurredAt: new Date("2026-09-10T12:00:00Z"), reversedAt: null };

describe("recebimento atribuído à aquisição", () => {
  it("deduplica pagamentos e mantém centavos exatos acima do limite numérico", () => {
    const first = { ...payment, amountCents: "9007199254740993" };
    expect(summarizeAcquisitionReceipts([first, first, { ...payment, id: "second" }], periodStart, periodEnd)).toMatchObject({ receiptCount: 2, receivedCents: "9007199254750994", netReceivedCents: "9007199254750994" });
  });
  it("reconstrói estorno no período inclusive de recebimento anterior e não antecipa reversão futura", () => {
    const receipts = summarizeAcquisitionReceipts([
      { ...payment, status: "REVERSED", reversedAt: new Date("2026-09-20T12:00:00Z") },
      { ...payment, id: "older", status: "CHARGEBACK", amountCents: "3000", occurredAt: new Date("2026-08-10T12:00:00Z"), reversedAt: new Date("2026-09-02T12:00:00Z") },
      { ...payment, id: "future-reversal", amountCents: "5000", status: "REVERSED", reversedAt: periodEnd },
    ], periodStart, periodEnd);
    expect(receipts).toMatchObject({ receivedCents: "15001", reversedCents: "13001", netReceivedCents: "2000", receiptCount: 2, reversalCount: 2 });
  });
  it("exclui sandbox, moeda estrangeira e moeda divergente da cobrança", () => {
    expect(summarizeAcquisitionReceipts([
      payment,
      { ...payment, id: "sandbox", providerKey: "LOCAL_PAYMENT_SANDBOX" },
      { ...payment, id: "dollar", currency: "USD", invoiceCurrency: "USD" },
      { ...payment, id: "mismatch", invoiceCurrency: "USD" },
    ], periodStart, periodEnd)).toMatchObject({ receivedCents: "10001", receiptCount: 1, excludedCount: 2 });
  });
  it("preserva valores sem origem no bucket não identificado e separa venda contratada do caixa", () => {
    const receipts = summarizeAcquisitionReceipts([payment], periodStart, periodEnd);
    expect(summarizeAcquisitionFunnel([{ ...lead, receipts, wins: [{ amountCents: 50000 }] }], "campaign")[0]).toMatchObject({ key: "unattributed", label: "Não identificado", revenueCents: 50000, receivedCents: "10001", netReceivedCents: "10001" });
    expect(summarizeAcquisitionFunnel([{ ...lead, receipts, utmCampaign: "  " }], "utmCampaign")[0]).toMatchObject({ key: "unattributed", netReceivedCents: "10001" });
    expect(summarizeAcquisitionFunnel([{ ...lead, receipts, utmCampaign: "unattributed" }, { ...lead, id: "unknown", receipts }], "utmCampaign").map((row) => row.key).sort()).toEqual(["unattributed", "utmCampaign:unattributed"]);
  });
});
