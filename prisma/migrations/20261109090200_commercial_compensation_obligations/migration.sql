CREATE TYPE "CommercialCompensationKind" AS ENUM ('SALE_COMMISSION', 'CLOSER_BONUS', 'SDR_COMMISSION', 'SDR_BONUS', 'LEGACY_STAGE');

CREATE TYPE "CommercialCompensationStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'APPROVED', 'PAID', 'REVIEW');

CREATE TABLE "commercial_compensation_obligations" (
    "workspaceId" UUID NOT NULL,
    "obligationKey" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "sellerMemberId" UUID NOT NULL,
    "opportunityId" UUID,
    "kind" "CommercialCompensationKind" NOT NULL,
    "status" "CommercialCompensationStatus" NOT NULL DEFAULT 'PENDING',
    "competenceMonth" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "basisCents" BIGINT,
    "milestoneOn" DATE,
    "eligibleAt" TIMESTAMPTZ(3),
    "dueOn" DATE,
    "reason" TEXT,
    "sourceFacts" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commercial_compensation_obligations_pkey" PRIMARY KEY ("workspaceId","obligationKey")
);

CREATE TABLE "commercial_compensation_allocations" (
    "workspaceId" UUID NOT NULL,
    "obligationKey" TEXT NOT NULL,
    "financialEntryId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "evidence" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID NOT NULL,

    CONSTRAINT "commercial_compensation_allocations_pkey" PRIMARY KEY ("workspaceId","obligationKey","financialEntryId")
);

CREATE TABLE "commercial_compensation_reviews" (
    "workspaceId" UUID NOT NULL,
    "obligationKey" TEXT NOT NULL,
    "sourceEventKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_compensation_reviews_pkey" PRIMARY KEY ("workspaceId","obligationKey","sourceEventKey")
);

CREATE INDEX "commercial_compensation_obligation_seller_idx" ON "commercial_compensation_obligations"("workspaceId", "sellerMemberId", "competenceMonth");

CREATE INDEX "commercial_compensation_obligation_due_idx" ON "commercial_compensation_obligations"("workspaceId", "status", "dueOn");

CREATE INDEX "commercial_compensation_obligation_sale_idx" ON "commercial_compensation_obligations"("workspaceId", "opportunityId");

CREATE INDEX "commercial_compensation_allocation_entry_idx" ON "commercial_compensation_allocations"("workspaceId", "financialEntryId");

ALTER TABLE "commercial_compensation_obligations" ADD CONSTRAINT "commercial_compensation_obligation_policy_fk" FOREIGN KEY ("workspaceId", "policyVersion") REFERENCES "commercial_compensation_policies"("workspaceId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_compensation_obligations" ADD CONSTRAINT "commercial_compensation_obligation_seller_fk" FOREIGN KEY ("workspaceId", "sellerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_compensation_obligations" ADD CONSTRAINT "commercial_compensation_obligation_opportunity_fk" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_compensation_allocations" ADD CONSTRAINT "commercial_compensation_allocation_obligation_fk" FOREIGN KEY ("workspaceId", "obligationKey") REFERENCES "commercial_compensation_obligations"("workspaceId", "obligationKey") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_compensation_allocations" ADD CONSTRAINT "commercial_compensation_allocation_entry_fk" FOREIGN KEY ("workspaceId", "financialEntryId") REFERENCES "financial_entries"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_compensation_allocations" ADD CONSTRAINT "commercial_compensation_allocation_actor_fk" FOREIGN KEY ("workspaceId", "recordedById") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_compensation_reviews" ADD CONSTRAINT "commercial_compensation_review_obligation_fk" FOREIGN KEY ("workspaceId", "obligationKey") REFERENCES "commercial_compensation_obligations"("workspaceId", "obligationKey") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commercial_compensation_obligations" ADD CONSTRAINT "commercial_compensation_obligation_values" CHECK (
  length(trim("obligationKey")) > 0 AND "revision" > 0
  AND "competenceMonth" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
  AND "amountCents" > 0 AND ("basisCents" IS NULL OR "basisCents" >= 0)
  AND jsonb_typeof("sourceFacts") = 'object'
  AND (("kind" IN ('SALE_COMMISSION', 'LEGACY_STAGE')) = ("opportunityId" IS NOT NULL))
  AND ("status" <> 'REVIEW' OR ("reason" IS NOT NULL AND length(trim("reason")) > 0))
);

ALTER TABLE "commercial_compensation_allocations" ADD CONSTRAINT "commercial_compensation_allocation_values"
  CHECK ("amountCents" > 0 AND length(trim("evidence")) > 0);

ALTER TABLE "commercial_compensation_reviews" ADD CONSTRAINT "commercial_compensation_review_values"
  CHECK (length(trim("sourceEventKey")) > 0 AND length(trim("reason")) > 0);

DO $$ BEGIN
  IF current_schema() = 'crm' THEN
    REVOKE ALL ON "commercial_compensation_obligations", "commercial_compensation_allocations", "commercial_compensation_reviews"
      FROM PUBLIC, anon, authenticated, service_role, crm_politizai_runtime;
    GRANT SELECT, INSERT, UPDATE ON "commercial_compensation_obligations" TO crm_politizai_runtime;
    GRANT SELECT, INSERT ON "commercial_compensation_allocations", "commercial_compensation_reviews" TO crm_politizai_runtime;
  END IF;
END $$;
