import { z } from "zod";

export const META_ADS_PROVIDER_KEY = "META_ADS";
export const META_ADS_ADAPTER_KEY = "meta-ads-read-v1";
export const META_ADS_DEFAULT_API_VERSION = "v26.0";
export const META_ADS_SUPPORTED_API_VERSIONS = ["v25.0", "v26.0"] as const;
export const META_ADS_ACCESS_TOKEN_ALIAS = "access-token";
export const META_ADS_APP_SECRET_ALIAS = "app-secret";
export const META_ADS_ACCESS_TOKEN_REFERENCE = "META_ADS_ACCESS_TOKEN";
export const META_ADS_APP_SECRET_REFERENCE = "META_ADS_APP_SECRET";
export const META_ADS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const isoDate = z.string().date();
const accountId = z.string().regex(/^act_[0-9]{3,40}$/);

export const metaAdsConfigurationSchema = z.object({
  graphApiVersion: z.enum(META_ADS_SUPPORTED_API_VERSIONS).default(META_ADS_DEFAULT_API_VERSION),
  selectedAccountIds: z.array(accountId).max(25).default([]),
  initialSince: isoDate,
  lookbackDays: z.number().int().min(1).max(37).default(7),
  pageSize: z.number().int().min(1).max(100).default(100),
  requestTimeoutMs: z.number().int().min(1_000).max(30_000).default(12_000),
}).strict();

export const metaAdsConfigureSchema = z.object({
  displayName: z.string().trim().min(3).max(100).default("Meta Ads"),
  revision: z.number().int().positive().optional(),
  config: metaAdsConfigurationSchema,
}).strict();

export const metaAdsCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONFIGURE"), data: metaAdsConfigureSchema }).strict(),
  z.object({ action: z.literal("TEST_CONNECTION") }).strict(),
  z.object({
    action: z.literal("RUN_SYNC"),
    mode: z.enum(["INITIAL", "INCREMENTAL"]),
    correlationId: z.string().trim().regex(/^meta-[A-Za-z0-9_-]{8,100}$/),
  }).strict(),
  z.object({ action: z.literal("PAUSE"), revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("RESUME"), revision: z.number().int().positive() }).strict(),
]);

const graphId = z.string().regex(/^[0-9]{3,40}$/);
const metaStatus = z.string().trim().min(1).max(40);

export const metaAdsIdentitySchema = z.object({
  id: graphId,
  name: z.string().trim().min(1).max(255),
}).passthrough();

export const metaAdsAccountSchema = z.object({
  id: accountId,
  account_id: graphId.optional(),
  name: z.string().trim().min(1).max(255),
  account_status: z.number().int().optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  timezone_name: z.string().trim().min(1).max(100).optional(),
}).passthrough();

export const metaAdsCampaignSchema = z.object({
  id: graphId,
  account_id: graphId.optional(),
  name: z.string().trim().min(1).max(255),
  status: metaStatus.optional(),
  start_time: z.string().datetime({ offset: true }).optional(),
  stop_time: z.string().datetime({ offset: true }).optional(),
}).passthrough();

export const metaAdsAdSetSchema = z.object({
  id: graphId,
  campaign_id: graphId,
  name: z.string().trim().min(1).max(255),
  status: metaStatus.optional(),
}).passthrough();

export const metaAdsAdSchema = z.object({
  id: graphId,
  adset_id: graphId,
  name: z.string().trim().min(1).max(255),
  status: metaStatus.optional(),
  creative: z.object({ id: graphId, name: z.string().trim().min(1).max(255).optional() }).passthrough().optional(),
}).passthrough();

const metricString = z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/);
export const metaAdsActionSchema = z.object({
  action_type: z.string().trim().min(1).max(160),
  value: metricString,
}).passthrough();

export const metaAdsInsightSchema = z.object({
  account_id: graphId,
  account_name: z.string().trim().min(1).max(255).optional(),
  account_currency: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  campaign_id: graphId,
  campaign_name: z.string().trim().min(1).max(255).optional(),
  adset_id: graphId,
  adset_name: z.string().trim().min(1).max(255).optional(),
  ad_id: graphId,
  ad_name: z.string().trim().min(1).max(255).optional(),
  date_start: isoDate,
  date_stop: isoDate,
  spend: metricString.optional(),
  impressions: metricString.optional(),
  reach: metricString.optional(),
  clicks: metricString.optional(),
  inline_link_clicks: metricString.optional(),
  actions: z.array(metaAdsActionSchema).optional(),
  action_values: z.array(metaAdsActionSchema).optional(),
}).passthrough();

export const metaGraphErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number().int().optional(),
    error_subcode: z.number().int().optional(),
    is_transient: z.boolean().optional(),
  }).passthrough(),
}).passthrough();

export const META_ADS_RECOGNIZED_ACTIONS = new Set([
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "link_click",
  "landing_page_view",
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "video_view",
]);

export type MetaAdsConfiguration = z.output<typeof metaAdsConfigurationSchema>;
export type MetaAdsIdentity = z.output<typeof metaAdsIdentitySchema>;
export type MetaAdsAccount = z.output<typeof metaAdsAccountSchema>;
export type MetaAdsCampaign = z.output<typeof metaAdsCampaignSchema>;
export type MetaAdsAdSet = z.output<typeof metaAdsAdSetSchema>;
export type MetaAdsAd = z.output<typeof metaAdsAdSchema>;
export type MetaAdsInsight = z.output<typeof metaAdsInsightSchema>;
export type MetaAdsAction = z.output<typeof metaAdsActionSchema>;

export type MetaAdsFailure = Readonly<{
  classification: "TRANSIENT" | "PERMANENT" | "AUTHENTICATION" | "PERMISSION" | "ACCOUNT_INACCESSIBLE" | "RATE_LIMIT" | "INVALID_PAYLOAD" | "INTERNAL" | "CONFIGURATION";
  code: string;
  safeMessage: string;
  retryAfterSeconds?: number;
}>;

export function decimalStringToMinorUnits(value: string, scale = 2): bigint {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(value)) throw new Error("INVALID_DECIMAL");
  const [whole, fraction = ""] = value.split(".");
  const padded = `${fraction}${"0".repeat(scale)}`;
  const kept = padded.slice(0, scale);
  const discarded = padded.slice(scale);
  let result = BigInt(whole!) * (10n ** BigInt(scale)) + BigInt(kept || "0");
  if (discarded.length > 0 && Number(discarded[0]) >= 5) result += 1n;
  return result;
}

export function integerMetric(value: string | undefined): bigint | null {
  if (value === undefined) return null;
  if (!/^[0-9]+(?:\.0+)?$/.test(value)) throw new Error("INVALID_INTEGER_METRIC");
  return BigInt(value.split(".")[0]!);
}

export function normalizeMetaMediaStatus(status: string | undefined): "ACTIVE" | "PAUSED" | "ARCHIVED" | "REVIEW_REQUIRED" {
  if (status === "ACTIVE") return "ACTIVE";
  if (status === "PAUSED") return "PAUSED";
  if (status === "ARCHIVED" || status === "DELETED") return "ARCHIVED";
  return "REVIEW_REQUIRED";
}

export function classifyMetaAction(actionType: string): "RECOGNIZED" | "UNKNOWN" {
  return META_ADS_RECOGNIZED_ACTIONS.has(actionType) ? "RECOGNIZED" : "UNKNOWN";
}

export function metaActionValue(actions: readonly MetaAdsAction[] | undefined, candidates: readonly string[]): bigint | null {
  if (!actions) return null;
  let found = false;
  let total = 0n;
  for (const action of actions) {
    if (!candidates.includes(action.action_type)) continue;
    found = true;
    total += integerMetric(action.value) ?? 0n;
  }
  return found ? total : null;
}

// Meta AdsActionStats defines actions.video_view as "3-Second Video Views".
// https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/
export function metaVideoComparable(actions: readonly MetaAdsAction[] | undefined) {
  return { videoMetricVersion: "meta-3s-v1", videoViews3s: metaActionValue(actions, ["video_view"])?.toString() ?? null };
}

export function metaActionMoneyValue(actions: readonly MetaAdsAction[] | undefined, candidates: readonly string[]): bigint | null {
  if (!actions) return null;
  let found = false;
  let total = 0n;
  for (const action of actions) {
    if (!candidates.includes(action.action_type)) continue;
    found = true;
    total += decimalStringToMinorUnits(action.value);
  }
  return found ? total : null;
}
