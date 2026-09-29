import { describe, expect, it } from "vitest";
import { hashTerritoryRule, LocalDeterministicGeocodingProvider, normalizeLocation, pointInPolygon, polygonSchema } from "./geography";

describe("geography domain", () => {
  it("normaliza Brasil, acentos e prefixo postal sem inventar coordenadas", () => {
    const value = normalizeLocation({ countryCode:"br", stateCode:"sp", city:"  São   Paulo ", postalCode:"01310-100", precision:"CITY", sourceType:"LEAD_LEGACY", evidenceClass:"FACT", confidenceBps:8500 });
    expect(value).toMatchObject({ countryCode:"BR", stateCode:"SP", city:"São Paulo", normalizedCity:"SAO PAULO", postalPrefix:"01310", latitude:null, longitude:null });
  });
  it("mantém homônimos distintos pela UF", () => {
    const base = { countryCode:"BR", city:"Bom Jesus", precision:"CITY", sourceType:"MANUAL_CONFIRMED", evidenceClass:"USER_CONFIRMED", confidenceBps:10000, verified:true } as const;
    expect(normalizeLocation({ ...base, stateCode:"PI" }).canonicalKey).not.toBe(normalizeLocation({ ...base, stateCode:"RS" }).canonicalKey);
  });
  it("recusa UF, coordenada e ponto exato sem confirmação", () => {
    expect(() => normalizeLocation({ countryCode:"BR", stateCode:"XX", precision:"STATE", sourceType:"LEAD_LEGACY", evidenceClass:"FACT", confidenceBps:8000 })).toThrow();
    expect(() => normalizeLocation({ countryCode:"US", latitude:91, longitude:0, precision:"APPROXIMATE_POINT", sourceType:"LOCAL_IMPORT", evidenceClass:"FACT", confidenceBps:8000 })).toThrow();
    expect(() => normalizeLocation({ countryCode:"BR", latitude:-23, longitude:-46, precision:"EXACT_POINT", sourceType:"MANUAL_CONFIRMED", evidenceClass:"USER_CONFIRMED", confidenceBps:10000 })).toThrow();
  });
  it("valida GeoJSON limitado e point-in-polygon", () => {
    const polygon = { type:"Polygon", coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]]] };
    expect(polygonSchema.parse(polygon)).toEqual(polygon);
    expect(pointInPolygon([5,5], polygon)).toBe(true);
    expect(pointInPolygon([20,5], polygon)).toBe(false);
    expect(() => polygonSchema.parse({ type:"Polygon", coordinates:[[[0,0],[1,0],[1,1],[0,1]]] })).toThrow();
  });
  it("adaptador local nunca inventa localização nem chama serviço externo", async () => {
    await expect(new LocalDeterministicGeocodingProvider().geocode({ countryCode:"BR", city:"São Paulo" })).resolves.toBeNull();
  });
  it("gera hash canônico incluindo regras aninhadas e polígonos", () => {
    const first = { code: "SP", polygon: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, priority: 10 };
    const reordered = { priority: 10, polygon: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]], type: "Polygon" }, code: "SP" };
    const changed = { ...first, polygon: { ...first.polygon, coordinates: [[[0, 0], [2, 0], [1, 1], [0, 0]]] } };
    expect(hashTerritoryRule(first)).toBe(hashTerritoryRule(reordered));
    expect(hashTerritoryRule(first)).not.toBe(hashTerritoryRule(changed));
  });
});
