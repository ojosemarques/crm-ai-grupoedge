import { describe, expect, it } from "vitest";
import { summarizeAcquisitionFunnel, type FunnelLead } from "./acquisition-funnel";

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
