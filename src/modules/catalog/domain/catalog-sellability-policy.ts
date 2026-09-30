import type { CatalogAudience, CatalogAvailability, CatalogItemKind, CatalogRevenueCategory, Currency, SalesGateProfile } from "@/generated/prisma/client";

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

export type TransactionalCatalogEligibilityInput = CatalogSellabilityInput & Readonly<{
  kind: CatalogItemKind;
  revenueCategory: CatalogRevenueCategory;
  salesGateProfile: SalesGateProfile;
  listPriceCents: bigint;
  currency: Currency;
}>;

const transactionalKinds = new Set<CatalogItemKind>(["PRODUCT", "PLAN", "LICENSE"]);

export function transactionalCatalogEligibilityReason(item: TransactionalCatalogEligibilityInput, now = new Date()): string | null {
  if (!item.active) return "ITEM_INACTIVE";
  if (item.audience !== "INDIVIDUAL") return "AUDIENCE_NOT_INDIVIDUAL";
  if (item.salesGateProfile !== "STANDARD") return "CONSULTATIVE_SALES_GATE";
  if (!transactionalKinds.has(item.kind) || item.revenueCategory !== "SOFTWARE") return "ITEM_NOT_TRANSACTIONAL";
  if (item.currency !== "BRL" || item.listPriceCents <= 0n || item.listPriceCents > BigInt(Number.MAX_SAFE_INTEGER)) return "PRICE_NOT_ELIGIBLE";
  if (item.availability !== "AVAILABLE") return "AVAILABILITY_NOT_SELLABLE";
  if (item.availableFrom && item.availableFrom > now) return "AVAILABILITY_NOT_STARTED";
  if (item.availableUntil && item.availableUntil < now) return "AVAILABILITY_ENDED";
  return null;
}

export function isTransactionalCatalogItemEligible(item: TransactionalCatalogEligibilityInput, now = new Date()) {
  return transactionalCatalogEligibilityReason(item, now) === null;
}
