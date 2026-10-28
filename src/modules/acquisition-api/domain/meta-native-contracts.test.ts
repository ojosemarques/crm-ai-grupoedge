import { describe, expect, it } from "vitest";
import { acquisitionConnectionSchema } from "./acquisition-contracts";
import { metaNativeConfigurationSchema, saoPauloDay } from "./meta-native-contracts";

describe("Forms Nativo", () => {
  it("delimita hoje em São Paulo inclusive quando UTC já mudou de dia", () => {
    expect(saoPauloDay(new Date("2026-10-29T01:30:00Z"))).toEqual({ start: new Date("2026-10-28T03:00:00Z"), end: new Date("2026-10-29T03:00:00Z") });
    expect(saoPauloDay(new Date("2026-10-29T03:00:00Z")).start.toISOString()).toBe("2026-10-29T03:00:00.000Z");
  });
  it("restringe IDs, destino e início da importação e não aceita credenciais no config", () => {
    const value = { pageId: "931101203422256", businessId: "1484709821933266", pipelineId: "10000000-0000-4000-8000-000000000001", initialStageId: "10000000-0000-4000-8000-000000000002", importFrom: "2026-10-28T03:00:00Z" };
    expect(metaNativeConfigurationSchema.parse(value).forms).toEqual([]);
    expect(metaNativeConfigurationSchema.safeParse({ ...value, pageId: "../me/accounts" }).success).toBe(false);
    expect(metaNativeConfigurationSchema.safeParse({ ...value, accessToken: "secret" }).success).toBe(false);
    const connection = { key: "meta-native", displayName: "Forms Nativo", provider: "META_LEAD_ADS", sourceKey: "meta", secretReferenceKey: "META_ADS_NATIVE_APP_SECRET", verificationTokenReferenceKey: "META_ADS_NATIVE_VERIFY_TOKEN", enrichmentTokenReferenceKey: "META_ADS_NATIVE_ACCESS_TOKEN", mapping: { fullName: "fields.full_name", phone: "fields.phone_number" }, metaNative: value };
    expect(acquisitionConnectionSchema.safeParse(connection).success).toBe(true);
    expect(acquisitionConnectionSchema.safeParse({ ...connection, provider: "FORM" }).success).toBe(false);
  });
});
