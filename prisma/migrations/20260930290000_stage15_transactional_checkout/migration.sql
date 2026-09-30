CREATE TYPE "CheckoutPaymentMethod" AS ENUM ('PIX', 'BOLETO');
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('PRE_CHECKOUT', 'PAYMENT_PENDING', 'ABANDONED', 'EXPIRED', 'DECLINED', 'PURCHASED', 'REFUNDED');
CREATE TYPE "CheckoutSubscriptionStatus" AS ENUM ('NOT_APPLICABLE', 'ACTIVE', 'PAST_DUE', 'CANCELLED');
CREATE TYPE "CheckoutEventType" AS ENUM ('PRE_CHECKOUT_CREATED', 'CHECKOUT_ABANDONED', 'PAYMENT_PENDING', 'PAYMENT_EXPIRED', 'PAYMENT_DECLINED', 'PURCHASE_CONFIRMED', 'PURCHASE_REFUNDED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_PAST_DUE', 'SUBSCRIPTION_CANCELLED');

ALTER TABLE "products" DROP CONSTRAINT "products_catalog_sellability_check";
ALTER TABLE "products" ADD CONSTRAINT "products_catalog_sellability_check" CHECK (
  NOT "active" OR (
    (
      "audience" = 'INSTITUTIONAL'
      AND "availability" IN ('AVAILABLE', 'CAPACITY_LIMITED')
      AND ("availability" <> 'CAPACITY_LIMITED' OR "capacityUnits" > 0)
    ) OR (
      "audience" = 'INDIVIDUAL'
      AND "availability" = 'AVAILABLE'
      AND "salesGateProfile" = 'STANDARD'
      AND "kind" IN ('PRODUCT', 'PLAN', 'LICENSE')
      AND "revenueCategory" = 'SOFTWARE'
      AND "currency" = 'BRL'
      AND "listPriceCents" > 0
    )
  )
);

CREATE TABLE "transactional_checkouts" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "ownerMemberId" UUID NOT NULL,
  "productCatalogItemIdSnapshot" UUID NOT NULL,
  "productVersionSnapshot" INTEGER NOT NULL,
  "productSkuSnapshot" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "productKindSnapshot" "CatalogItemKind" NOT NULL,
  "unitPriceCentsSnapshot" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "paymentMethod" "CheckoutPaymentMethod" NOT NULL,
  "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'PRE_CHECKOUT',
  "subscriptionStatus" "CheckoutSubscriptionStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  "providerKey" TEXT NOT NULL DEFAULT 'POLITIZAI_SIGNED_CHECKOUT_V1',
  "externalCheckoutId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "sourceMetadata" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "lastAppliedProviderOccurredAt" TIMESTAMPTZ(3),
  "lastAppliedProviderEventId" TEXT,
  "lastAppliedProviderSequence" INTEGER NOT NULL DEFAULT 0,
  "abandonedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "purchasedAt" TIMESTAMPTZ(3),
  "refundedAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "transactional_checkouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transactional_checkouts_workspaceId_id_key" UNIQUE ("workspaceId", "id"),
  CONSTRAINT "transactional_checkouts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactional_checkouts_workspaceId_productId_fkey" FOREIGN KEY ("workspaceId", "productId") REFERENCES "products"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactional_checkouts_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactional_checkouts_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "transactional_checkout_events" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "checkoutId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "CheckoutEventType" NOT NULL,
  "previousStatus" "CheckoutSessionStatus",
  "newStatus" "CheckoutSessionStatus" NOT NULL,
  "previousSubscriptionStatus" "CheckoutSubscriptionStatus",
  "newSubscriptionStatus" "CheckoutSubscriptionStatus" NOT NULL,
  "providerKey" TEXT NOT NULL,
  "providerEventId" TEXT,
  "providerSequence" INTEGER,
  "payloadHash" TEXT NOT NULL,
  "nonceHash" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied" BOOLEAN NOT NULL DEFAULT true,
  "ignoredReason" TEXT,
  "safeMetadata" JSONB,
  "actorId" UUID NOT NULL,
  CONSTRAINT "transactional_checkout_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transactional_checkout_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactional_checkout_events_workspaceId_checkoutId_fkey" FOREIGN KEY ("workspaceId", "checkoutId") REFERENCES "transactional_checkouts"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "transactional_checkout_events_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "transactional_checkouts_workspaceId_idempotencyKey_key" ON "transactional_checkouts"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "transactional_checkouts_workspaceId_providerKey_externalCheckoutId_key" ON "transactional_checkouts"("workspaceId", "providerKey", "externalCheckoutId");
CREATE INDEX "transactional_checkouts_workspaceId_productId_createdAt_idx" ON "transactional_checkouts"("workspaceId", "productId", "createdAt");
CREATE INDEX "transactional_checkouts_workspaceId_ownerMemberId_status_updatedAt_idx" ON "transactional_checkouts"("workspaceId", "ownerMemberId", "status", "updatedAt");
CREATE INDEX "transactional_checkouts_workspaceId_status_updatedAt_idx" ON "transactional_checkouts"("workspaceId", "status", "updatedAt");
CREATE INDEX "transactional_checkouts_workspaceId_subscriptionStatus_updatedAt_idx" ON "transactional_checkouts"("workspaceId", "subscriptionStatus", "updatedAt");
CREATE UNIQUE INDEX "transactional_checkout_events_workspaceId_checkoutId_sequence_key" ON "transactional_checkout_events"("workspaceId", "checkoutId", "sequence");
CREATE UNIQUE INDEX "transactional_checkout_events_workspaceId_idempotencyKey_key" ON "transactional_checkout_events"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "transactional_checkout_events_workspaceId_providerKey_providerEventId_key" ON "transactional_checkout_events"("workspaceId", "providerKey", "providerEventId");
CREATE UNIQUE INDEX "transactional_checkout_events_workspaceId_providerKey_nonceHash_key" ON "transactional_checkout_events"("workspaceId", "providerKey", "nonceHash");
CREATE INDEX "transactional_checkout_events_workspaceId_checkoutId_occurredAt_idx" ON "transactional_checkout_events"("workspaceId", "checkoutId", "occurredAt");
CREATE INDEX "transactional_checkout_events_workspaceId_applied_occurredAt_idx" ON "transactional_checkout_events"("workspaceId", "applied", "occurredAt");
