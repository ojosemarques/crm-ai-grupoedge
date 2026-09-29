-- CreateEnum
CREATE TYPE "PriorityBandCode" AS ENUM ('P1', 'P2', 'P3');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "disqualificationReasonId" UUID;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "offerTemplateId" UUID;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "lossReasonId" UUID;

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "warningMinutesBeforeDue" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_priority_bands" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "slaPolicyId" UUID NOT NULL,
    "code" "PriorityBandCode" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "scoreMin" INTEGER NOT NULL,
    "scoreMax" INTEGER NOT NULL,
    "leadPriority" "LeadPriority" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "lead_priority_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loss_reasons" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "loss_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disqualification_reasons" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "disqualification_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" BIGINT NOT NULL,
    "discountCents" BIGINT NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "validDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "offer_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sla_policies_workspaceId_key_active_deletedAt_idx" ON "sla_policies"("workspaceId", "key", "active", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_workspaceId_id_key" ON "sla_policies"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "lead_priority_bands_workspaceId_code_active_deletedAt_idx" ON "lead_priority_bands"("workspaceId", "code", "active", "deletedAt");

-- CreateIndex
CREATE INDEX "lead_priority_bands_workspaceId_scoreMin_scoreMax_active_de_idx" ON "lead_priority_bands"("workspaceId", "scoreMin", "scoreMax", "active", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "lead_priority_bands_workspaceId_id_key" ON "lead_priority_bands"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "loss_reasons_workspaceId_key_active_deletedAt_idx" ON "loss_reasons"("workspaceId", "key", "active", "deletedAt");

-- CreateIndex
CREATE INDEX "loss_reasons_workspaceId_position_active_deletedAt_idx" ON "loss_reasons"("workspaceId", "position", "active", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "loss_reasons_workspaceId_id_key" ON "loss_reasons"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "disqualification_reasons_workspaceId_key_active_deletedAt_idx" ON "disqualification_reasons"("workspaceId", "key", "active", "deletedAt");

-- CreateIndex
CREATE INDEX "disqualification_reasons_workspaceId_position_active_delete_idx" ON "disqualification_reasons"("workspaceId", "position", "active", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "disqualification_reasons_workspaceId_id_key" ON "disqualification_reasons"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "offer_templates_workspaceId_key_active_deletedAt_idx" ON "offer_templates"("workspaceId", "key", "active", "deletedAt");

-- CreateIndex
CREATE INDEX "offer_templates_workspaceId_productId_active_deletedAt_idx" ON "offer_templates"("workspaceId", "productId", "active", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "offer_templates_workspaceId_id_key" ON "offer_templates"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "offer_templates_workspaceId_productId_id_key" ON "offer_templates"("workspaceId", "productId", "id");

-- CreateIndex
CREATE INDEX "leads_workspaceId_disqualificationReasonId_status_deletedAt_idx" ON "leads"("workspaceId", "disqualificationReasonId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "offers_workspaceId_offerTemplateId_createdAt_idx" ON "offers"("workspaceId", "offerTemplateId", "createdAt");

-- CreateIndex
CREATE INDEX "opportunities_workspaceId_lossReasonId_status_deletedAt_idx" ON "opportunities"("workspaceId", "lossReasonId", "status", "deletedAt");

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_priority_bands" ADD CONSTRAINT "lead_priority_bands_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_priority_bands" ADD CONSTRAINT "lead_priority_bands_workspaceId_slaPolicyId_fkey" FOREIGN KEY ("workspaceId", "slaPolicyId") REFERENCES "sla_policies"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_priority_bands" ADD CONSTRAINT "lead_priority_bands_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_priority_bands" ADD CONSTRAINT "lead_priority_bands_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loss_reasons" ADD CONSTRAINT "loss_reasons_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disqualification_reasons" ADD CONSTRAINT "disqualification_reasons_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disqualification_reasons" ADD CONSTRAINT "disqualification_reasons_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disqualification_reasons" ADD CONSTRAINT "disqualification_reasons_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspaceId_disqualificationReasonId_fkey" FOREIGN KEY ("workspaceId", "disqualificationReasonId") REFERENCES "disqualification_reasons"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspaceId_lossReasonId_fkey" FOREIGN KEY ("workspaceId", "lossReasonId") REFERENCES "loss_reasons"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_templates" ADD CONSTRAINT "offer_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_templates" ADD CONSTRAINT "offer_templates_workspaceId_productId_fkey" FOREIGN KEY ("workspaceId", "productId") REFERENCES "products"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_templates" ADD CONSTRAINT "offer_templates_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_templates" ADD CONSTRAINT "offer_templates_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_workspaceId_productId_offerTemplateId_fkey" FOREIGN KEY ("workspaceId", "productId", "offerTemplateId") REFERENCES "offer_templates"("workspaceId", "productId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Configurations are reusable after soft delete, but unique while active.
CREATE UNIQUE INDEX "sla_policies_workspace_key_active_key"
  ON "sla_policies" ("workspaceId", lower("key"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "priority_bands_workspace_code_active_key"
  ON "lead_priority_bands" ("workspaceId", "code")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "priority_bands_workspace_position_active_key"
  ON "lead_priority_bands" ("workspaceId", "position")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "loss_reasons_workspace_key_active_key"
  ON "loss_reasons" ("workspaceId", lower("key"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "loss_reasons_workspace_position_active_key"
  ON "loss_reasons" ("workspaceId", "position")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "disqualification_reasons_workspace_key_active_key"
  ON "disqualification_reasons" ("workspaceId", lower("key"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "disqualification_reasons_workspace_position_active_key"
  ON "disqualification_reasons" ("workspaceId", "position")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "offer_templates_workspace_key_active_key"
  ON "offer_templates" ("workspaceId", lower("key"))
  WHERE "deletedAt" IS NULL;

-- Typed configuration invariants used by SLA, scoring and offer calculations.
ALTER TABLE "sla_policies"
  ADD CONSTRAINT "sla_policies_values_check"
  CHECK (
    "firstResponseMinutes" > 0
    AND "warningMinutesBeforeDue" >= 0
    AND "warningMinutesBeforeDue" < "firstResponseMinutes"
  ),
  ADD CONSTRAINT "sla_policies_text_check"
  CHECK (btrim("key") <> '' AND btrim("name") <> '');

ALTER TABLE "lead_priority_bands"
  ADD CONSTRAINT "priority_bands_score_check"
  CHECK (
    "position" >= 0
    AND "scoreMin" >= 0
    AND "scoreMax" <= 100
    AND "scoreMin" <= "scoreMax"
  ),
  ADD CONSTRAINT "priority_bands_name_check"
  CHECK (btrim("name") <> '');

ALTER TABLE "loss_reasons"
  ADD CONSTRAINT "loss_reasons_values_check"
  CHECK ("position" >= 0 AND btrim("key") <> '' AND btrim("name") <> '');

ALTER TABLE "disqualification_reasons"
  ADD CONSTRAINT "disqualification_reasons_values_check"
  CHECK ("position" >= 0 AND btrim("key") <> '' AND btrim("name") <> '');

ALTER TABLE "offer_templates"
  ADD CONSTRAINT "offer_templates_values_check"
  CHECK (
    "priceCents" >= 0
    AND "discountCents" >= 0
    AND "discountCents" <= "priceCents"
    AND ("validDays" IS NULL OR "validDays" > 0)
    AND btrim("key") <> ''
    AND btrim("name") <> ''
  );
