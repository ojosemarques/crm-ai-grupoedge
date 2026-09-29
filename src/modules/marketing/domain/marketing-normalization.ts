import { createHash } from "node:crypto";
import type { MarketingEvidenceInput } from "@/modules/marketing/domain/marketing-contracts";

const collapse = (value: string | undefined, lower = false) => {
  const normalized = value?.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  return lower ? normalized.toLocaleLowerCase("pt-BR") : normalized;
};

function safeUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

export function hashClickId(value: string): string {
  return createHash("sha256").update(value.normalize("NFKC").trim()).digest("hex");
}

export function normalizeMarketingEvidence(input: MarketingEvidenceInput) {
  const landing = safeUrl(input.landingUrl);
  const referrer = safeUrl(input.referrerUrl);
  const clickEntry = Object.entries(input.clickIds ?? {}).sort(([a], [b]) => a.localeCompare(b))[0];
  return Object.freeze({
    sessionPublicId: collapse(input.sessionPublicId),
    landingPageKey: collapse(input.landingPageKey, true),
    marketingFormKey: collapse(input.marketingFormKey, true),
    marketingFormVersion: input.marketingFormVersion ?? null,
    landingPath: landing ? `${landing.pathname}${landing.search}`.slice(0, 2_048) : null,
    referrerHost: referrer?.hostname.toLocaleLowerCase("en-US") ?? null,
    utmSource: collapse(input.utmSource, true),
    utmMedium: collapse(input.utmMedium, true),
    utmCampaign: collapse(input.utmCampaign),
    utmContent: collapse(input.utmContent),
    utmTerm: collapse(input.utmTerm),
    clickIdType: clickEntry?.[0] ?? null,
    clickIdHash: clickEntry ? hashClickId(clickEntry[1]) : null,
    facts: [
      input.utmSource ? "utm_source fornecido" : null,
      input.referrerUrl ? "referenciador fornecido" : null,
      clickEntry ? `${clickEntry[0]} fornecido e armazenado apenas como hash` : null,
    ].filter((value): value is string => Boolean(value)),
    missingEvidence: [
      !input.utmSource ? "utm_source" : null,
      !input.sessionPublicId ? "session_public_id" : null,
    ].filter((value): value is string => Boolean(value)),
  });
}
