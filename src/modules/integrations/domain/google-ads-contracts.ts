import { z } from "zod";

export const GOOGLE_ADS_PROVIDER_KEY = "GOOGLE_ADS";
export const GOOGLE_ADS_ADAPTER_KEY = "google-ads-read-v1";
export const GOOGLE_ADS_DEFAULT_API_VERSION = "v25";
export const GOOGLE_ADS_SUPPORTED_API_VERSIONS = ["v24", "v25"] as const;
export const GOOGLE_ADS_QUERY_TEMPLATE_VERSION = "google-ads-gaql/1.0";
export const GOOGLE_ADS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export const GOOGLE_ADS_SECRET_REFERENCES = Object.freeze({
  oauthClientId: "GOOGLE_ADS_OAUTH_CLIENT_ID",
  oauthClientSecret: "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  oauthRefreshToken: "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
  serviceAccountEmail: "GOOGLE_ADS_SERVICE_ACCOUNT_EMAIL",
  serviceAccountPrivateKey: "GOOGLE_ADS_SERVICE_ACCOUNT_PRIVATE_KEY",
  developerToken: "GOOGLE_ADS_DEVELOPER_TOKEN",
});

const customerId = z.string().regex(/^[0-9]{10}$/);
const isoDate = z.string().date();
const authStrategy = z.enum(["SERVICE_ACCOUNT", "OAUTH_REFRESH_TOKEN"]);

export function normalizeGoogleCustomerId(value: string): string {
  const normalized = value.replaceAll("-", "").trim();
  if (!/^[0-9]{10}$/.test(normalized)) throw new Error("INVALID_GOOGLE_CUSTOMER_ID");
  return normalized;
}

export const googleAdsConfigurationSchema = z.object({
  apiVersion: z.enum(GOOGLE_ADS_SUPPORTED_API_VERSIONS).default(GOOGLE_ADS_DEFAULT_API_VERSION),
  authStrategy: authStrategy.default("SERVICE_ACCOUNT"),
  loginCustomerId: customerId.nullable().default(null),
  selectedCustomerIds: z.array(customerId).max(50).default([]),
  initialSince: isoDate,
  lookbackDays: z.number().int().min(1).max(37).default(7),
  pageSize: z.number().int().min(100).max(10_000).default(10_000),
  requestTimeoutMs: z.number().int().min(1_000).max(30_000).default(12_000),
}).strict();

export const googleAdsConfigureSchema = z.object({
  displayName: z.string().trim().min(3).max(100).default("Google Ads"),
  revision: z.number().int().positive().optional(),
  config: googleAdsConfigurationSchema,
}).strict();

export const googleAdsCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONFIGURE"), data: googleAdsConfigureSchema }).strict(),
  z.object({ action: z.literal("TEST_CONNECTION") }).strict(),
  z.object({ action: z.literal("RUN_SYNC"), mode: z.enum(["INITIAL", "INCREMENTAL"]), correlationId: z.string().regex(/^google-[A-Za-z0-9_-]{8,100}$/) }).strict(),
  z.object({ action: z.literal("PREVIEW_BACKFILL"), since: isoDate, until: isoDate }).strict(),
  z.object({ action: z.literal("RUN_BACKFILL"), since: isoDate, until: isoDate, confirmation: z.literal("CONFIRM_GOOGLE_ADS_BACKFILL"), correlationId: z.string().regex(/^google-[A-Za-z0-9_-]{8,100}$/) }).strict(),
  z.object({ action: z.literal("PAUSE"), revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("RESUME"), revision: z.number().int().positive() }).strict(),
]);

const resourceName = z.string().trim().min(3).max(500);
const metric = z.string().regex(/^-?[0-9]+(?:\.[0-9]+)?$/);
const integerMetric = z.string().regex(/^[0-9]+$/);

export const googleAccessibleCustomersSchema = z.object({
  resourceNames: z.array(z.string().regex(/^customers\/[0-9]{10}$/)).max(5_000),
}).passthrough();

export const googleCustomerRowSchema = z.object({
  customerClient: z.object({
    id: z.string().regex(/^[0-9]{10}$/),
    clientCustomer: resourceName,
    descriptiveName: z.string().max(255).nullish(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    timeZone: z.string().min(1).max(100),
    manager: z.boolean(),
    level: z.string().regex(/^[0-9]+$/),
    status: z.string().max(80),
  }).passthrough(),
}).passthrough();

export const googleAdMetricRowSchema = z.object({
  customer: z.object({ id: z.string().regex(/^[0-9]{10}$/), descriptiveName: z.string().max(255).nullish(), currencyCode: z.string().regex(/^[A-Z]{3}$/), timeZone: z.string().min(1).max(100) }).passthrough(),
  campaign: z.object({ id: z.string().regex(/^[0-9]+$/), resourceName, name: z.string().min(1).max(255), status: z.string().max(80), advertisingChannelType: z.string().max(80) }).passthrough(),
  adGroup: z.object({ id: z.string().regex(/^[0-9]+$/), resourceName, name: z.string().min(1).max(255), status: z.string().max(80) }).passthrough(),
  adGroupAd: z.object({ resourceName, status: z.string().max(80), ad: z.object({ id: z.string().regex(/^[0-9]+$/), resourceName, name: z.string().max(255).nullish(), type: z.string().max(80) }).passthrough() }).passthrough(),
  segments: z.object({ date: isoDate }).passthrough(),
  metrics: z.object({
    costMicros: integerMetric.optional(), impressions: integerMetric.optional(), clicks: integerMetric.optional(), interactions: integerMetric.optional(),
    conversions: metric.optional(), conversionsValue: metric.optional(), allConversions: metric.optional(), allConversionsValue: metric.optional(),
    ctr: metric.optional(), averageCpc: metric.optional(), averageCpm: metric.optional(),
  }).passthrough(),
}).passthrough();

export const googleAssetRowSchema = z.object({
  adGroupAdAssetView: z.object({ resourceName, fieldType: z.string().max(80), performanceLabel: z.string().max(80), enabled: z.boolean().optional() }).passthrough(),
  adGroupAd: z.object({ resourceName, ad: z.object({ id: z.string().regex(/^[0-9]+$/), resourceName }).passthrough() }).passthrough(),
  asset: z.object({ id: z.string().regex(/^[0-9]+$/), resourceName, name: z.string().max(255).nullish(), type: z.string().max(80) }).passthrough(),
}).passthrough();

export const googleSearchResponseSchema = z.object({ results: z.array(z.unknown()).default([]), nextPageToken: z.string().max(2_000).optional(), totalResultsCount: z.string().regex(/^[0-9]+$/).optional(), requestId: z.string().max(200).optional() }).passthrough();
export const googleErrorSchema = z.object({ error: z.object({ code: z.number().int().optional(), status: z.string().optional(), message: z.string().optional(), details: z.array(z.unknown()).optional() }).passthrough() }).passthrough();

export type GoogleAdsConfiguration = z.output<typeof googleAdsConfigurationSchema>;
export type GoogleCustomerRow = z.output<typeof googleCustomerRowSchema>;
export type GoogleAdMetricRow = z.output<typeof googleAdMetricRowSchema>;
export type GoogleAssetRow = z.output<typeof googleAssetRowSchema>;
export type GoogleAdsFailure = Readonly<{ classification: "TRANSIENT" | "PERMANENT" | "AUTHENTICATION" | "PERMISSION" | "ACCOUNT_INACCESSIBLE" | "RATE_LIMIT" | "INVALID_PAYLOAD" | "INTERNAL" | "CONFIGURATION"; code: string; safeMessage: string; requestId?: string; retryAfterSeconds?: number }>;

export function decimalToMicros(value: string): bigint {
  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) throw new Error("INVALID_DECIMAL");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const padded = `${fraction}000000`;
  let micros = BigInt(whole!) * 1_000_000n + BigInt(padded.slice(0, 6));
  if (padded.length > 6 && Number(padded[6]) >= 5) micros += 1n;
  return negative ? -micros : micros;
}

export function microsToCents(micros: bigint): bigint {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const cents = (absolute + 5_000n) / 10_000n;
  return negative ? -cents : cents;
}

export function optionalInteger(value: string | undefined): bigint | null { return value === undefined ? null : BigInt(value); }
export function optionalDecimalMicros(value: string | undefined): bigint | null { return value === undefined ? null : decimalToMicros(value); }

export function normalizeGoogleStatus(status: string): "ACTIVE" | "PAUSED" | "ARCHIVED" | "REVIEW_REQUIRED" {
  if (status === "ENABLED") return "ACTIVE";
  if (status === "PAUSED") return "PAUSED";
  if (status === "REMOVED") return "ARCHIVED";
  return "REVIEW_REQUIRED";
}

export function safeGoogleRequestId(value: string | null | undefined): string | undefined {
  return value && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : undefined;
}
