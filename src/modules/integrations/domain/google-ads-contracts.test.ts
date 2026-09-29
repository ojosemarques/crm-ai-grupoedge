import { describe, expect, it } from "vitest";
import {
  GOOGLE_ADS_QUERY_TEMPLATE_VERSION,
  decimalToMicros,
  googleAdsConfigurationSchema,
  microsToCents,
  normalizeGoogleCustomerId,
  optionalDecimalMicros,
} from "@/modules/integrations/domain/google-ads-contracts";

describe("CRM-41 contratos Google Ads", () => {
  it("normaliza apenas customer IDs de dez dígitos", () => {
    expect(normalizeGoogleCustomerId("123-456-7890")).toBe("1234567890");
    expect(() => normalizeGoogleCustomerId("public")).toThrow("INVALID_GOOGLE_CUSTOMER_ID");
  });

  it("converte decimais e micros sem ponto flutuante", () => {
    expect(decimalToMicros("1.2345674")).toBe(1_234_567n);
    expect(decimalToMicros("1.2345675")).toBe(1_234_568n);
    expect(microsToCents(10_245_000n)).toBe(1_025n);
    expect(microsToCents(10_244_999n)).toBe(1_024n);
  });

  it("separa zero informado de métrica ausente", () => {
    expect(optionalDecimalMicros("0")).toBe(0n);
    expect(optionalDecimalMicros(undefined)).toBeNull();
  });

  it("restringe versão, janela e seleção da configuração", () => {
    const parsed = googleAdsConfigurationSchema.parse({ initialSince: "2026-09-01" });
    expect(parsed).toMatchObject({ apiVersion: "v25", authStrategy: "SERVICE_ACCOUNT", selectedCustomerIds: [] });
    expect(GOOGLE_ADS_QUERY_TEMPLATE_VERSION).toBe("google-ads-gaql/1.0");
    expect(() => googleAdsConfigurationSchema.parse({ apiVersion: "v23", initialSince: "2026-09-01" })).toThrow();
  });
});
