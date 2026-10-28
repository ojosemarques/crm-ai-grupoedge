import { describe, expect, it } from "vitest";
import { realtimeDashboardFrontSchema, realtimeFactPipelineId } from "./realtime-dashboard-front";

describe("frentes do tempo real", () => {
  it("aceita apenas as duas frentes e mantém prospecção como padrão", () => {
    expect(realtimeDashboardFrontSchema.parse(undefined)).toBe("PROSPECTING");
    expect(realtimeDashboardFrontSchema.parse("ADVERTISING")).toBe("ADVERTISING");
    expect(() => realtimeDashboardFrontSchema.parse("ALL")).toThrow();
  });
  it("prioriza a frente do evento e mantém fatos sem classificação fora das duas frentes", () => {
    expect(realtimeFactPipelineId({ pipelineId: "opportunity", safeMetadata: { _commercialFrontPipelineId: "advertising" } })).toBe("advertising");
    expect(realtimeFactPipelineId({ pipelineId: "prospecting", safeMetadata: null })).toBe("prospecting");
    expect(realtimeFactPipelineId({ pipelineId: null, safeMetadata: {} })).toBeNull();
  });
  it("mantém o estorno na frente do evento original mesmo sem metadados próprios", () => {
    expect(realtimeFactPipelineId({ pipelineId: null, safeMetadata: {}, correctionSource: { pipelineId: null, safeMetadata: { _commercialFrontPipelineId: "advertising" } } })).toBe("advertising");
  });
});
