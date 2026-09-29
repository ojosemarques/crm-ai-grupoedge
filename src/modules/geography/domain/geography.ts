import { createHash } from "node:crypto";
import { z } from "zod";

export const GEOGRAPHY_RULE_VERSION = "crm42-v1";
export const GEOGRAPHY_MINIMUM_GROUP_SIZE = 5;
export const BRAZIL_STATE_CODES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;
const brazilStates = new Set<string>(BRAZIL_STATE_CODES);

export const geographicTargetTypes = ["CONTACT","ACCOUNT","LEAD","TOUCHPOINT","CONVERSION"] as const;
export const geographicEvidenceClasses = ["FACT","INFERENCE","USER_CONFIRMED"] as const;
export const geographicPrecisions = ["COUNTRY","STATE","CITY","POSTAL_PREFIX","APPROXIMATE_POINT","EXACT_POINT"] as const;
export const geographicSourceTypes = ["FORM_DECLARED","MANUAL_CONFIRMED","ACCOUNT_DECLARED","LEAD_LEGACY","TOUCHPOINT_EXPLICIT","LOCAL_IMPORT","GEOCODER_FUTURE","IP_COARSE_FUTURE","COMMERCIAL_INFERENCE"] as const;
export const territoryTypes = ["COUNTRY","REGION","STATE","CITY","POSTAL_PREFIX","POLYGON"] as const;

const optionalText = z.string().trim().min(1).max(180).optional();
const coordinate = z.number().finite();

export const locationInputSchema = z.object({
  countryCode: z.string().trim().length(2),
  stateCode: optionalText,
  city: optionalText,
  officialCityCode: z.string().trim().regex(/^\d{7}$/).optional(),
  postalCode: z.string().trim().max(16).optional(),
  latitude: coordinate.optional(),
  longitude: coordinate.optional(),
  precision: z.enum(geographicPrecisions),
  sourceType: z.enum(geographicSourceTypes),
  evidenceClass: z.enum(geographicEvidenceClasses),
  confidenceBps: z.number().int().min(0).max(10_000),
  verified: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  const country = value.countryCode.toUpperCase();
  const state = value.stateCode?.toUpperCase();
  if (country === "BR" && state && !brazilStates.has(state)) context.addIssue({ code: "custom", path: ["stateCode"], message: "UF brasileira inválida." });
  if (value.city && !state) context.addIssue({ code: "custom", path: ["stateCode"], message: "Município exige estado/UF para evitar homônimos." });
  if ((value.latitude === undefined) !== (value.longitude === undefined)) context.addIssue({ code: "custom", path: ["latitude"], message: "Latitude e longitude devem ser informadas juntas." });
  if (value.latitude !== undefined && (value.latitude < -90 || value.latitude > 90)) context.addIssue({ code: "custom", path: ["latitude"], message: "Latitude fora do intervalo permitido." });
  if (value.longitude !== undefined && (value.longitude < -180 || value.longitude > 180)) context.addIssue({ code: "custom", path: ["longitude"], message: "Longitude fora do intervalo permitido." });
  if (value.precision === "EXACT_POINT" && (!value.verified || value.latitude === undefined)) context.addIssue({ code: "custom", path: ["precision"], message: "Ponto exato exige coordenadas legítimas e confirmação." });
});

export type NormalizedLocation = Readonly<{
  countryCode: string; stateCode: string | null; city: string | null; normalizedCity: string | null;
  officialCityCode: string | null; postalPrefix: string | null; latitude: number | null; longitude: number | null;
  precision: typeof geographicPrecisions[number]; sourceType: typeof geographicSourceTypes[number];
  evidenceClass: typeof geographicEvidenceClasses[number]; confidenceBps: number; verificationStatus: "VERIFIED" | "UNVERIFIED";
  canonicalKey: string;
}>;

export function normalizeGeographicText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeLocation(input: unknown): NormalizedLocation {
  const value = locationInputSchema.parse(input);
  const countryCode = value.countryCode.toUpperCase();
  const stateCode = value.stateCode?.toUpperCase() ?? null;
  const city = value.city?.trim().replace(/\s+/g, " ") ?? null;
  const normalizedCity = city ? normalizeGeographicText(city) : null;
  const compactPostal = value.postalCode?.toUpperCase().replace(/[^0-9A-Z]/g, "") ?? null;
  const postalPrefix = compactPostal ? (countryCode === "BR" ? compactPostal.slice(0, 5) : compactPostal.slice(0, 12)) : null;
  const canonicalKey = [countryCode, stateCode ?? "_", normalizedCity ?? "_", value.officialCityCode ?? "_", postalPrefix ?? "_", value.latitude ?? "_", value.longitude ?? "_", value.precision].join(":");
  return Object.freeze({ countryCode, stateCode, city, normalizedCity, officialCityCode: value.officialCityCode ?? null, postalPrefix, latitude: value.latitude ?? null, longitude: value.longitude ?? null, precision: value.precision, sourceType: value.sourceType, evidenceClass: value.evidenceClass, confidenceBps: value.confidenceBps, verificationStatus: value.verified ? "VERIFIED" : "UNVERIFIED", canonicalKey });
}

const positionSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(positionSchema).min(4).max(1_000)).min(1).max(8),
}).strict().superRefine((polygon, context) => {
  let vertices = 0;
  for (const [index, ring] of polygon.coordinates.entries()) {
    vertices += ring.length;
    const first = ring[0]; const last = ring.at(-1);
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) context.addIssue({ code: "custom", path: ["coordinates", index], message: "Cada anel deve estar fechado." });
  }
  if (vertices > 1_000) context.addIssue({ code: "custom", path: ["coordinates"], message: "Polígono excede 1.000 vértices." });
});

export type Polygon = z.infer<typeof polygonSchema>;

function ringContains(point: readonly [number, number], ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index]!; const [px, py] = ring[previous]!;
    if ((y > point[1]) !== (py > point[1]) && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: readonly [number, number], input: unknown): boolean {
  const polygon = polygonSchema.parse(input);
  if (!ringContains(point, polygon.coordinates[0]!)) return false;
  return polygon.coordinates.slice(1).every((hole) => !ringContains(point, hole));
}

export const territoryInputSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/), name: z.string().trim().min(2).max(120),
  type: z.enum(territoryTypes), priority: z.number().int().min(0).max(10_000), countryCode: z.string().trim().length(2).optional(),
  stateCode: optionalText, city: optionalText, postalPrefix: z.string().trim().regex(/^[0-9A-Z-]{3,12}$/).optional(), polygon: polygonSchema.optional(),
  ownerTeamId: z.string().uuid().optional(), timeZone: z.string().trim().min(3).max(80).optional(),
  effectiveFrom: z.string().datetime({ offset: true }), effectiveTo: z.string().datetime({ offset: true }).optional(), reason: z.string().trim().min(5).max(500),
}).strict().superRefine((value, context) => {
  const required: Record<typeof territoryTypes[number], keyof typeof value | null> = { COUNTRY:"countryCode", REGION:null, STATE:"stateCode", CITY:"city", POSTAL_PREFIX:"postalPrefix", POLYGON:"polygon" };
  const field = required[value.type]; if (field && !value[field]) context.addIssue({ code:"custom", path:[field], message:`Território ${value.type} exige ${field}.` });
  if (value.city && !value.stateCode) context.addIssue({ code:"custom", path:["stateCode"], message:"Município exige UF." });
  if (value.effectiveTo && new Date(value.effectiveTo) <= new Date(value.effectiveFrom)) context.addIssue({ code:"custom", path:["effectiveTo"], message:"Fim da vigência deve ser posterior ao início." });
});

export function hashTerritoryRule(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export type GeocodingRequest = Readonly<{ countryCode: string; stateCode?: string; city?: string; postalCode?: string }>;
export type GeocodingResult = Readonly<{ latitude: number; longitude: number; precision: "APPROXIMATE_POINT" | "EXACT_POINT"; providerReference: string }>;
export interface GeocodingProvider { readonly mode: "LOCAL_DETERMINISTIC" | "EXTERNAL"; geocode(input: GeocodingRequest): Promise<GeocodingResult | null>; }
export class LocalDeterministicGeocodingProvider implements GeocodingProvider {
  readonly mode = "LOCAL_DETERMINISTIC" as const;
  async geocode(input: GeocodingRequest): Promise<null> {
    void input;
    return null;
  }
}
