import type { CatalogAudience, CatalogAvailability } from "@/generated/prisma/client";

export type CatalogSellabilityInput = Readonly<{
  active: boolean;
  audience: CatalogAudience;
  availability: CatalogAvailability;
  capacityUnits: number | null;
  availableFrom?: Date | null;
  availableUntil?: Date | null;
}>;

export function catalogSellabilityReason(item: CatalogSellabilityInput, now = new Date()): string | null {
  if (!item.active) return "ITEM_INACTIVE";
  if (item.audience !== "INSTITUTIONAL") return "AUDIENCE_NOT_APPROVED";
  if (item.availability !== "AVAILABLE" && item.availability !== "CAPACITY_LIMITED") return "AVAILABILITY_NOT_SELLABLE";
  if (item.availableFrom && item.availableFrom > now) return "AVAILABILITY_NOT_STARTED";
  if (item.availableUntil && item.availableUntil < now) return "AVAILABILITY_ENDED";
  if (item.availability === "CAPACITY_LIMITED" && (!item.capacityUnits || item.capacityUnits < 1)) return "CAPACITY_UNAVAILABLE";
  return null;
}

export function isCatalogItemSellable(item: CatalogSellabilityInput, now = new Date()) {
  return catalogSellabilityReason(item, now) === null;
}
