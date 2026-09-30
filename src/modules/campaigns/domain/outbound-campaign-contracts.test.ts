import { describe, expect, it } from "vitest";
import { campaignCommandSchema, createCampaignSchema } from "./outbound-campaign-contracts";

describe("outbound campaign contracts", () => {
  it("separa canal de envio e recusa janela invertida", () => {
    expect(() => createCampaignSchema.parse({ name: "Teste pequeno", channel: "SMS", purposeKey: "commercial", templateBody: "Olá", windowStartMinute: 1000, windowEndMinute: 900 })).toThrow();
  });

  it("exige hash congelado e justificativa para aprovação", () => {
    expect(() => campaignCommandSchema.parse({ action: "APPROVE", campaignId: crypto.randomUUID(), expectedSnapshotHash: "short", reason: "ok" })).toThrow();
  });
});
