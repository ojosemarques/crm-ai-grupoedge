import { describe, expect, it } from "vitest";
import { commercialFrontPipelineIds, EMPTY_PIPELINE_ID } from "./commercial-front";

describe("recorte das frentes comerciais", () => {
  const pipelines = [{ id: "a", name: "Anúncios" }, { id: "p", name: "Prospecção Ativa" }, { id: "x", name: "Outro" }];
  it("consolida apenas as duas frentes e intersecta filtros", () => {
    expect(commercialFrontPipelineIds("ALL", pipelines)).toEqual(["a", "p"]);
    expect(commercialFrontPipelineIds("ADVERTISING", pipelines, ["a", "x"])).toEqual(["a"]);
    expect(commercialFrontPipelineIds("PROSPECTING", pipelines)).toEqual(["p"]);
  });
  it("falha fechado quando não há pipeline ou a seleção pertence a outra frente", () => {
    expect(commercialFrontPipelineIds("ADVERTISING", [])).toEqual([EMPTY_PIPELINE_ID]);
    expect(commercialFrontPipelineIds("ADVERTISING", pipelines, ["p"])).toEqual([EMPTY_PIPELINE_ID]);
  });
});
