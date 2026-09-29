import { describe, expect, it } from "vitest";
import { hashClickId, normalizeMarketingEvidence } from "@/modules/marketing/domain/marketing-normalization";

describe("normalizeMarketingEvidence", () => {
  it("normaliza UTM/referrer e nunca persiste o click id bruto", () => {
    const result = normalizeMarketingEvidence({
      sessionPublicId: " session-1 ",
      landingUrl: "https://politizai.com.br/oferta?utm_source=Google",
      referrerUrl: "https://WWW.GOOGLE.COM/search?q=crm",
      utmSource: " Google ",
      utmMedium: " CPC ",
      utmCampaign: " Campanha  A ",
      clickIds: { gclid: "secret-click-id" },
    });
    expect(result).toMatchObject({
      sessionPublicId: "session-1",
      landingPath: "/oferta?utm_source=Google",
      referrerHost: "www.google.com",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "Campanha A",
      clickIdType: "gclid",
      clickIdHash: hashClickId("secret-click-id"),
    });
    expect(JSON.stringify(result)).not.toContain("secret-click-id");
  });

  it("separa ausência de evidência de valor negativo", () => {
    const result = normalizeMarketingEvidence({});
    expect(result.utmSource).toBeNull();
    expect(result.missingEvidence).toEqual(["utm_source", "session_public_id"]);
  });
});
