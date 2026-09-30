CREATE TYPE "CatalogItemKind" AS ENUM ('PRODUCT', 'MODULE', 'LINE', 'PLAN', 'LICENSE', 'IMPLEMENTATION', 'RECURRING_SERVICE', 'PROJECT');
CREATE TYPE "CatalogRevenueCategory" AS ENUM ('SOFTWARE', 'IMPLEMENTATION', 'RECURRING_SERVICE', 'PROJECT');
CREATE TYPE "CatalogAudience" AS ENUM ('INSTITUTIONAL', 'INDIVIDUAL', 'GOVERNMENT');
CREATE TYPE "CatalogAvailability" AS ENUM ('DRAFT', 'AVAILABLE', 'CAPACITY_LIMITED', 'FUTURE', 'RETIRED');
ALTER TYPE "AccountContactRoleType" ADD VALUE 'BUYER';
ALTER TYPE "AccountContactRoleType" ADD VALUE 'SPONSOR';

DROP INDEX "products_workspace_sku_active_key";
CREATE UNIQUE INDEX "products_workspace_sku_active_key" ON "products" ("workspaceId", lower("sku")) WHERE "deletedAt" IS NULL AND "active" = true;
DROP INDEX "offer_templates_workspace_key_active_key";
CREATE UNIQUE INDEX "offer_templates_workspace_key_active_key" ON "offer_templates" ("workspaceId", lower("key")) WHERE "deletedAt" IS NULL AND "active" = true;

ALTER TABLE "products" ADD COLUMN "catalogItemId" UUID, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "kind" "CatalogItemKind" NOT NULL DEFAULT 'PRODUCT', ADD COLUMN "revenueCategory" "CatalogRevenueCategory" NOT NULL DEFAULT 'SOFTWARE', ADD COLUMN "audience" "CatalogAudience" NOT NULL DEFAULT 'INSTITUTIONAL', ADD COLUMN "availability" "CatalogAvailability" NOT NULL DEFAULT 'AVAILABLE', ADD COLUMN "capacityUnits" INTEGER, ADD COLUMN "approvedConditions" TEXT NOT NULL DEFAULT 'Condições comerciais padrão aprovadas.', ADD COLUMN "availableFrom" TIMESTAMPTZ(3), ADD COLUMN "availableUntil" TIMESTAMPTZ(3);
UPDATE "products" SET "catalogItemId" = gen_random_uuid() WHERE "catalogItemId" IS NULL;
ALTER TABLE "products" ALTER COLUMN "catalogItemId" SET NOT NULL;
CREATE UNIQUE INDEX "products_workspaceId_catalogItemId_version_key" ON "products"("workspaceId", "catalogItemId", "version");
ALTER TABLE "products" ADD CONSTRAINT "products_catalog_sellability_check" CHECK (NOT "active" OR ("audience" = 'INSTITUTIONAL' AND "availability" IN ('AVAILABLE', 'CAPACITY_LIMITED') AND ("availability" <> 'CAPACITY_LIMITED' OR "capacityUnits" > 0)));
ALTER TABLE "products" ADD CONSTRAINT "products_catalog_window_check" CHECK ("availableUntil" IS NULL OR "availableFrom" IS NULL OR "availableUntil" >= "availableFrom");

ALTER TABLE "offer_templates" ADD COLUMN "catalogTemplateId" UUID, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "availability" "CatalogAvailability" NOT NULL DEFAULT 'AVAILABLE', ADD COLUMN "approvedConditions" TEXT NOT NULL DEFAULT 'Condições comerciais padrão aprovadas.';
UPDATE "offer_templates" SET "catalogTemplateId" = gen_random_uuid() WHERE "catalogTemplateId" IS NULL;
ALTER TABLE "offer_templates" ALTER COLUMN "catalogTemplateId" SET NOT NULL;
CREATE UNIQUE INDEX "offer_templates_workspaceId_catalogTemplateId_version_key" ON "offer_templates"("workspaceId", "catalogTemplateId", "version");
ALTER TABLE "offer_templates" ADD CONSTRAINT "offer_templates_sellability_check" CHECK (NOT "active" OR "availability" IN ('AVAILABLE', 'CAPACITY_LIMITED'));

CREATE TABLE "catalog_bundle_lines" ("id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "offerTemplateId" UUID NOT NULL, "productId" UUID NOT NULL, "position" INTEGER NOT NULL, "quantity" INTEGER NOT NULL DEFAULT 1, "unitPriceCents" BIGINT NOT NULL, "discountCents" BIGINT NOT NULL DEFAULT 0, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "catalog_bundle_lines_pkey" PRIMARY KEY ("id"), CONSTRAINT "catalog_bundle_lines_values_check" CHECK ("position" > 0 AND "quantity" > 0 AND "unitPriceCents" >= 0 AND "discountCents" >= 0 AND "discountCents" <= "unitPriceCents" * "quantity"));
CREATE UNIQUE INDEX "catalog_bundle_lines_workspaceId_id_key" ON "catalog_bundle_lines"("workspaceId", "id");
CREATE UNIQUE INDEX "catalog_bundle_lines_workspaceId_offerTemplateId_position_key" ON "catalog_bundle_lines"("workspaceId", "offerTemplateId", "position");
CREATE INDEX "catalog_bundle_lines_workspaceId_productId_idx" ON "catalog_bundle_lines"("workspaceId", "productId");
ALTER TABLE "catalog_bundle_lines" ADD CONSTRAINT "catalog_bundle_lines_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "catalog_bundle_lines" ADD CONSTRAINT "catalog_bundle_lines_template_fkey" FOREIGN KEY ("workspaceId", "offerTemplateId") REFERENCES "offer_templates"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "catalog_bundle_lines" ADD CONSTRAINT "catalog_bundle_lines_product_fkey" FOREIGN KEY ("workspaceId", "productId") REFERENCES "products"("workspaceId", "id") ON DELETE RESTRICT;
INSERT INTO "catalog_bundle_lines" ("id", "workspaceId", "offerTemplateId", "productId", "position", "quantity", "unitPriceCents", "discountCents") SELECT gen_random_uuid(), "workspaceId", "id", "productId", 1, 1, "priceCents", "discountCents" FROM "offer_templates";

CREATE TABLE "offer_lines" ("id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "offerId" UUID NOT NULL, "productId" UUID NOT NULL, "position" INTEGER NOT NULL, "productVersionSnapshot" INTEGER NOT NULL, "productSkuSnapshot" TEXT NOT NULL, "productNameSnapshot" TEXT NOT NULL, "productKindSnapshot" "CatalogItemKind" NOT NULL, "revenueCategorySnapshot" "CatalogRevenueCategory" NOT NULL, "approvedConditionsSnapshot" TEXT NOT NULL, "quantity" INTEGER NOT NULL, "unitPriceCents" BIGINT NOT NULL, "discountCents" BIGINT NOT NULL DEFAULT 0, "totalCents" BIGINT NOT NULL, "currency" "Currency" NOT NULL DEFAULT 'BRL', "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "offer_lines_pkey" PRIMARY KEY ("id"), CONSTRAINT "offer_lines_values_check" CHECK ("position" > 0 AND "quantity" > 0 AND "unitPriceCents" >= 0 AND "discountCents" >= 0 AND "totalCents" = "unitPriceCents" * "quantity" - "discountCents"));
CREATE UNIQUE INDEX "offer_lines_workspaceId_id_key" ON "offer_lines"("workspaceId", "id");
CREATE UNIQUE INDEX "offer_lines_workspaceId_offerId_position_key" ON "offer_lines"("workspaceId", "offerId", "position");
CREATE INDEX "offer_lines_workspaceId_productId_idx" ON "offer_lines"("workspaceId", "productId");
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_offer_fkey" FOREIGN KEY ("workspaceId", "offerId") REFERENCES "offers"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "offer_lines" ADD CONSTRAINT "offer_lines_product_fkey" FOREIGN KEY ("workspaceId", "productId") REFERENCES "products"("workspaceId", "id") ON DELETE RESTRICT;
INSERT INTO "offer_lines" ("id", "workspaceId", "offerId", "productId", "position", "productVersionSnapshot", "productSkuSnapshot", "productNameSnapshot", "productKindSnapshot", "revenueCategorySnapshot", "approvedConditionsSnapshot", "quantity", "unitPriceCents", "discountCents", "totalCents", "currency", "createdAt") SELECT gen_random_uuid(), o."workspaceId", o."id", o."productId", 1, p."version", p."sku", p."name", p."kind", p."revenueCategory", p."approvedConditions", o."quantity", o."unitPriceCents", o."discountCents", o."totalCents", o."currency", o."createdAt" FROM "offers" o JOIN "products" p ON p."workspaceId" = o."workspaceId" AND p."id" = o."productId";

ALTER TABLE "contract_line_snapshots" ADD COLUMN "productVersionSnapshot" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "productKindSnapshot" "CatalogItemKind" NOT NULL DEFAULT 'PRODUCT', ADD COLUMN "revenueCategorySnapshot" "CatalogRevenueCategory" NOT NULL DEFAULT 'SOFTWARE', ADD COLUMN "approvedConditionsSnapshot" TEXT NOT NULL DEFAULT 'Condições comerciais padrão aprovadas.';
UPDATE "contract_line_snapshots" cls SET "productVersionSnapshot" = p."version", "productKindSnapshot" = p."kind", "revenueCategorySnapshot" = p."revenueCategory", "approvedConditionsSnapshot" = p."approvedConditions" FROM "products" p WHERE p."workspaceId" = cls."workspaceId" AND p."id" = cls."productId";
