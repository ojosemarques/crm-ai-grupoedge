CREATE TYPE "CommercialSaleModality" AS ENUM (
  'ANNUAL_PREPAID', 'ANNUAL_INSTALLMENTS', 'PROJECT', 'EXPANSION',
  'NEGOTIATED_RENEWAL', 'AUTOMATIC_RENEWAL', 'AUTOMATIC_LOW_TICKET'
);

CREATE TABLE "commercial_sale_confirmations" (
  "workspaceId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "sellerMemberId" UUID NOT NULL,
  "modality" "CommercialSaleModality" NOT NULL,
  "netContractCents" BIGINT NOT NULL,
  "upfrontCents" BIGINT NOT NULL,
  "selfSourced" BOOLEAN NOT NULL,
  "sourceEvidence" TEXT NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
  "activationAt" TIMESTAMPTZ(3),
  "confirmationReason" TEXT NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedByActorId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  CONSTRAINT "commercial_sale_confirmations_pkey" PRIMARY KEY ("workspaceId", "opportunityId", "revision"),
  CONSTRAINT "commercial_sale_confirmation_opportunity_fk" FOREIGN KEY ("workspaceId", "opportunityId")
    REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_sale_confirmation_seller_fk" FOREIGN KEY ("workspaceId", "sellerMemberId")
    REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_sale_confirmation_actor_fk" FOREIGN KEY ("workspaceId", "confirmedByActorId")
    REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_sale_confirmation_values" CHECK (
    "revision" > 0 AND "netContractCents" > 0 AND "upfrontCents" BETWEEN 0 AND "netContractCents"
    AND length(trim("confirmationReason")) > 0 AND length(trim("sourceEvidence")) > 0
    AND length(trim("idempotencyKey")) > 0 AND "acceptedAt" <= "confirmedAt"
    AND ("activationAt" IS NULL OR "activationAt" <= "confirmedAt")
  )
);

CREATE UNIQUE INDEX "commercial_sale_confirmations_workspaceId_idempotencyKey_key"
  ON "commercial_sale_confirmations"("workspaceId", "idempotencyKey");
CREATE INDEX "commercial_sale_confirmations_workspaceId_sellerMemberId_idx"
  ON "commercial_sale_confirmations"("workspaceId", "sellerMemberId");
CREATE INDEX "commercial_sale_confirmations_actor_idx"
  ON "commercial_sale_confirmations"("workspaceId", "confirmedByActorId");

DO $$ BEGIN
  IF current_schema() = 'crm' THEN
    REVOKE ALL ON "commercial_sale_confirmations" FROM PUBLIC, anon, authenticated, service_role, crm_politizai_runtime;
    GRANT SELECT, INSERT ON "commercial_sale_confirmations" TO crm_politizai_runtime;
  END IF;
END $$;
