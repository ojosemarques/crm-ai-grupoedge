import encodeQR from "qr";

import type { MarketingFormDefinition } from "@/modules/marketing-forms/domain/marketing-form-contracts";

export function buildMarketingFormShareUrl(origin: string, slug: string, sharing: MarketingFormDefinition["sharing"]): string {
  const base = new URL(`/f/${encodeURIComponent(slug)}`, origin);
  if (sharing.defaultUtmSource) base.searchParams.set("utm_source", sharing.defaultUtmSource);
  if (sharing.defaultUtmMedium) base.searchParams.set("utm_medium", sharing.defaultUtmMedium);
  if (sharing.defaultUtmCampaign) base.searchParams.set("utm_campaign", sharing.defaultUtmCampaign);
  return base.toString();
}

export function marketingFormQrDataUrl(url: string): string {
  return encodeQR(url, "data-url", { ecc: "medium", border: 4, scale: 6 });
}
