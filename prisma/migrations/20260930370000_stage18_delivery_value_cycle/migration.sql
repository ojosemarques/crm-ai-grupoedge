CREATE TYPE "DeliveryPlanType" AS ENUM ('LICENSE', 'IMPLEMENTATION', 'MANAGED_SERVICE', 'LAB_PROJECT');
CREATE TYPE "DeliveryPlanStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "handoff_transfer_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "handoffId" UUID NOT NULL,
  "version" INTEGER NOT NULL, "contractVersionId" UUID, "diagnosis" JSONB NOT NULL, "promise" JSONB NOT NULL,
  "scope" JSONB NOT NULL, "approvals" JSONB NOT NULL, "users" JSONB NOT NULL, "risks" JSONB NOT NULL,
  "contractTotalCents" BIGINT NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "handoff_transfer_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "handoff_transfer_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "handoff_transfer_versions_total_check" CHECK ("contractTotalCents" >= 0)
);
CREATE UNIQUE INDEX "handoff_transfer_versions_workspaceId_id_key" ON "handoff_transfer_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "handoff_transfer_versions_workspaceId_handoffId_version_key" ON "handoff_transfer_versions"("workspaceId", "handoffId", "version");
CREATE INDEX "handoff_transfer_versions_workspaceId_contractVersionId_idx" ON "handoff_transfer_versions"("workspaceId", "contractVersionId");

CREATE TABLE "delivery_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "handoffId" UUID NOT NULL,
  "transferVersionId" UUID NOT NULL, "type" "DeliveryPlanType" NOT NULL, "status" "DeliveryPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL, "currency" "Currency" NOT NULL DEFAULT 'BRL', "contractedValueCents" BIGINT NOT NULL,
  "sourceContractLineIds" JSONB NOT NULL, "acceptedByActorId" UUID, "acceptedAt" TIMESTAMPTZ(3),
  "acceptanceReason" TEXT, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "delivery_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_plans_value_check" CHECK ("contractedValueCents" >= 0),
  CONSTRAINT "delivery_plans_acceptance_check" CHECK (("status" = 'DRAFT' AND "acceptedByActorId" IS NULL AND "acceptedAt" IS NULL AND "acceptanceReason" IS NULL) OR ("status" <> 'DRAFT' AND "acceptedByActorId" IS NOT NULL AND "acceptedAt" IS NOT NULL AND char_length("acceptanceReason") >= 8))
);
CREATE UNIQUE INDEX "delivery_plans_workspaceId_id_key" ON "delivery_plans"("workspaceId", "id");
CREATE UNIQUE INDEX "delivery_plans_workspaceId_handoffId_type_key" ON "delivery_plans"("workspaceId", "handoffId", "type");
CREATE INDEX "delivery_plans_workspaceId_status_type_createdAt_idx" ON "delivery_plans"("workspaceId", "status", "type", "createdAt");

CREATE TABLE "delivery_checklist_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "deliveryPlanId" UUID NOT NULL,
  "key" TEXT NOT NULL, "name" TEXT NOT NULL, "position" INTEGER NOT NULL, "required" BOOLEAN NOT NULL DEFAULT true,
  "expectedDurationHours" INTEGER NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_checklist_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_checklist_items_position_check" CHECK ("position" > 0),
  CONSTRAINT "delivery_checklist_items_duration_check" CHECK ("expectedDurationHours" > 0)
);
CREATE UNIQUE INDEX "delivery_checklist_items_workspaceId_id_key" ON "delivery_checklist_items"("workspaceId", "id");
CREATE UNIQUE INDEX "delivery_checklist_items_workspaceId_deliveryPlanId_key_key" ON "delivery_checklist_items"("workspaceId", "deliveryPlanId", "key");
CREATE UNIQUE INDEX "delivery_checklist_items_workspaceId_deliveryPlanId_position_key" ON "delivery_checklist_items"("workspaceId", "deliveryPlanId", "position");
CREATE INDEX "delivery_checklist_items_workspaceId_deliveryPlanId_required_idx" ON "delivery_checklist_items"("workspaceId", "deliveryPlanId", "required");

ALTER TABLE "handoff_transfer_versions" ADD CONSTRAINT "handoff_transfer_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_transfer_versions" ADD CONSTRAINT "handoff_transfer_versions_handoffId_fkey" FOREIGN KEY ("workspaceId", "handoffId") REFERENCES "customer_handoffs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_transfer_versions" ADD CONSTRAINT "handoff_transfer_versions_contractVersionId_fkey" FOREIGN KEY ("workspaceId", "contractVersionId") REFERENCES "contract_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handoff_transfer_versions" ADD CONSTRAINT "handoff_transfer_versions_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_handoffId_fkey" FOREIGN KEY ("workspaceId", "handoffId") REFERENCES "customer_handoffs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_transferVersionId_fkey" FOREIGN KEY ("workspaceId", "transferVersionId") REFERENCES "handoff_transfer_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_acceptedByActorId_fkey" FOREIGN KEY ("workspaceId", "acceptedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_plans" ADD CONSTRAINT "delivery_plans_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_checklist_items" ADD CONSTRAINT "delivery_checklist_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_checklist_items" ADD CONSTRAINT "delivery_checklist_items_deliveryPlanId_fkey" FOREIGN KEY ("workspaceId", "deliveryPlanId") REFERENCES "delivery_plans"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION crm_stage18_reject_transfer_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'handoff transfer versions are append-only'; END;
$$;
CREATE TRIGGER "handoff_transfer_versions_append_only" BEFORE UPDATE OR DELETE ON "handoff_transfer_versions" FOR EACH ROW EXECUTE FUNCTION crm_stage18_reject_transfer_mutation();
