CREATE TYPE "CommercialContractStatus" AS ENUM ('DRAFT', 'INTERNAL_REVIEW', 'READY_TO_SEND', 'SENT_SIMULATED', 'ACCEPTED', 'REJECTED', 'VOIDED', 'SUPERSEDED', 'EXPIRED');
CREATE TYPE "ContractVersionState" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED');
CREATE TYPE "ContractBillingFrequency" AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM');
CREATE TYPE "ContractTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "ContractEventType" AS ENUM ('CREATED', 'DRAFT_REVISED', 'INTERNAL_REVIEW_REQUESTED', 'READY_TO_SEND', 'SENT_SIMULATED', 'ACCEPTED_LOCAL_MANUAL', 'REJECTED', 'VOIDED', 'EXPIRED', 'VERSION_CREATED', 'VERSION_SUPERSEDED', 'RECONCILIATION_RECORDED');
CREATE TYPE "ContractBackfillMode" AS ENUM ('DRY_RUN', 'EXECUTE');
CREATE TYPE "ContractBackfillStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "ContractBackfillItemAction" AS ENUM ('REVIEW_REQUIRED', 'SKIPPED');

CREATE TABLE "commercial_contracts" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "contractNumber" TEXT NOT NULL,
  "opportunityId" UUID NOT NULL, "accountId" UUID NOT NULL, "primaryContactId" UUID NOT NULL,
  "ownerMemberId" UUID NOT NULL, "currentVersionId" UUID,
  "status" "CommercialContractStatus" NOT NULL DEFAULT 'DRAFT', "revision" INTEGER NOT NULL DEFAULT 1,
  "acceptedAt" TIMESTAMPTZ(3), "effectiveStartsAt" TIMESTAMPTZ(3), "effectiveEndsAt" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_contracts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commercial_contracts_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "commercial_contracts_effective_range_check" CHECK ("effectiveEndsAt" IS NULL OR "effectiveStartsAt" IS NULL OR "effectiveEndsAt" >= "effectiveStartsAt")
);

CREATE TABLE "contract_number_sequences" (
  "workspaceId" UUID NOT NULL, "nextValue" BIGINT NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_number_sequences_pkey" PRIMARY KEY ("workspaceId"),
  CONSTRAINT "contract_number_sequences_positive_check" CHECK ("nextValue" > 0)
);

CREATE TABLE "contract_versions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "contractId" UUID NOT NULL, "versionNumber" INTEGER NOT NULL,
  "state" "ContractVersionState" NOT NULL DEFAULT 'DRAFT', "sourceOfferId" UUID, "templateVersionId" UUID,
  "templateNameSnapshot" TEXT NOT NULL, "templateVersionSnapshot" INTEGER NOT NULL,
  "opportunityNameSnapshot" TEXT NOT NULL, "accountNameSnapshot" TEXT NOT NULL,
  "accountLegalNameSnapshot" TEXT, "accountDocumentSnapshot" TEXT, "contactNameSnapshot" TEXT NOT NULL,
  "contactRoleSnapshot" TEXT, "contactEmailSnapshot" TEXT, "contactPhoneSnapshot" TEXT,
  "currency" "Currency" NOT NULL DEFAULT 'BRL', "subtotalCents" BIGINT NOT NULL,
  "discountCents" BIGINT NOT NULL, "totalCents" BIGINT NOT NULL, "mrrCents" BIGINT NOT NULL DEFAULT 0,
  "tcvCents" BIGINT NOT NULL DEFAULT 0, "billingFrequency" "ContractBillingFrequency" NOT NULL DEFAULT 'ONE_TIME',
  "durationMonths" INTEGER, "proposedStartsAt" TIMESTAMPTZ(3), "proposedEndsAt" TIMESTAMPTZ(3),
  "renewalExpected" BOOLEAN NOT NULL DEFAULT false, "paymentTerms" TEXT NOT NULL,
  "commercialNotes" TEXT, "zeroValueJustification" TEXT, "renderedHtml" TEXT, "contentHash" TEXT,
  "issuedAt" TIMESTAMPTZ(3), "issuedByActorId" UUID, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_versions_values_check" CHECK ("subtotalCents" >= 0 AND "discountCents" >= 0 AND "totalCents" >= 0 AND "mrrCents" >= 0 AND "tcvCents" >= 0 AND "totalCents" = "subtotalCents" - "discountCents"),
  CONSTRAINT "contract_versions_duration_check" CHECK ("durationMonths" IS NULL OR "durationMonths" > 0),
  CONSTRAINT "contract_versions_range_check" CHECK ("proposedEndsAt" IS NULL OR "proposedStartsAt" IS NULL OR "proposedEndsAt" >= "proposedStartsAt"),
  CONSTRAINT "contract_versions_zero_check" CHECK ("totalCents" > 0 OR length(trim(COALESCE("zeroValueJustification", ''))) >= 5),
  CONSTRAINT "contract_versions_issue_check" CHECK (("state" = 'DRAFT' AND "issuedAt" IS NULL AND "contentHash" IS NULL) OR ("state" <> 'DRAFT' AND "issuedAt" IS NOT NULL AND "contentHash" IS NOT NULL AND "renderedHtml" IS NOT NULL))
);

CREATE TABLE "contract_line_snapshots" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "contractVersionId" UUID NOT NULL, "position" INTEGER NOT NULL,
  "sourceOfferId" UUID, "sourceOfferTemplateId" UUID, "productId" UUID NOT NULL,
  "productSkuSnapshot" TEXT NOT NULL, "productNameSnapshot" TEXT NOT NULL, "offerNameSnapshot" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL, "unitPriceCents" BIGINT NOT NULL, "discountCents" BIGINT NOT NULL,
  "totalCents" BIGINT NOT NULL, "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_line_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_lines_values_check" CHECK ("position" >= 0 AND "quantity" > 0 AND "unitPriceCents" >= 0 AND "discountCents" >= 0 AND "totalCents" >= 0 AND "totalCents" = "unitPriceCents" * "quantity" - "discountCents")
);

CREATE TABLE "contract_clause_snapshots" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "contractVersionId" UUID NOT NULL,
  "position" INTEGER NOT NULL, "key" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_clause_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_clause_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "contract_events" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "contractId" UUID NOT NULL, "contractVersionId" UUID,
  "eventType" "ContractEventType" NOT NULL, "fromStatus" "CommercialContractStatus", "toStatus" "CommercialContractStatus",
  "reason" TEXT, "idempotencyKey" TEXT NOT NULL, "acceptedByName" TEXT, "acceptedByRole" TEXT,
  "acceptanceMethod" TEXT, "evidenceText" TEXT, "evidenceHash" TEXT,
  "effectiveStartsAt" TIMESTAMPTZ(3), "effectiveEndsAt" TIMESTAMPTZ(3), "safeMetadata" JSONB,
  "actorId" UUID NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_event_reason_check" CHECK ("eventType" NOT IN ('DRAFT_REVISED','REJECTED','VOIDED','VERSION_SUPERSEDED') OR length(trim(COALESCE("reason", ''))) >= 5),
  CONSTRAINT "contract_event_acceptance_check" CHECK ("eventType" <> 'ACCEPTED_LOCAL_MANUAL' OR ("acceptanceMethod" = 'LOCAL_MANUAL' AND "acceptedByName" IS NOT NULL AND "acceptedByRole" IS NOT NULL AND "evidenceHash" IS NOT NULL))
);

CREATE TABLE "contract_templates" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL, "purpose" TEXT NOT NULL,
  "status" "ContractTemplateStatus" NOT NULL DEFAULT 'DRAFT', "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "legalReviewState" TEXT NOT NULL DEFAULT 'PENDING_LEGAL', "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMPTZ(3), CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_template_version_check" CHECK ("currentVersion" > 0),
  CONSTRAINT "contract_template_legal_check" CHECK ("legalReviewState" IN ('PENDING_LEGAL','APPROVED','REJECTED'))
);

CREATE TABLE "contract_template_versions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "templateId" UUID NOT NULL, "version" INTEGER NOT NULL,
  "titleTemplate" TEXT NOT NULL, "introduction" TEXT NOT NULL, "allowedVariables" TEXT[] NOT NULL,
  "contentHash" TEXT NOT NULL, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_template_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_template_versions_number_check" CHECK ("version" > 0)
);

CREATE TABLE "contract_template_clauses" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "templateVersionId" UUID NOT NULL,
  "position" INTEGER NOT NULL, "key" TEXT NOT NULL, "titleTemplate" TEXT NOT NULL, "bodyTemplate" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_template_clauses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_template_clause_position_check" CHECK ("position" >= 0)
);

CREATE TABLE "contract_backfill_runs" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "runKey" TEXT NOT NULL, "mode" "ContractBackfillMode" NOT NULL,
  "status" "ContractBackfillStatus" NOT NULL DEFAULT 'RUNNING', "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "reviewRequiredCount" INTEGER NOT NULL DEFAULT 0, "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "requestedByActorId" UUID NOT NULL, "startedAt" TIMESTAMPTZ(3) NOT NULL, "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_backfill_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_backfill_counts_check" CHECK ("candidateCount" >= 0 AND "reviewRequiredCount" >= 0 AND "skippedCount" >= 0)
);

CREATE TABLE "contract_backfill_items" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "runId" UUID NOT NULL, "opportunityId" UUID NOT NULL,
  "action" "ContractBackfillItemAction" NOT NULL, "reasonCode" TEXT NOT NULL, "evidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_backfill_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commercial_contracts_workspaceId_id_key" ON "commercial_contracts"("workspaceId", "id");
CREATE UNIQUE INDEX "commercial_contracts_workspaceId_contractNumber_key" ON "commercial_contracts"("workspaceId", "contractNumber");
CREATE UNIQUE INDEX "commercial_contracts_workspaceId_opportunityId_key" ON "commercial_contracts"("workspaceId", "opportunityId");
CREATE INDEX "commercial_contracts_owner_status_idx" ON "commercial_contracts"("workspaceId", "ownerMemberId", "status", "updatedAt");
CREATE INDEX "commercial_contracts_account_status_idx" ON "commercial_contracts"("workspaceId", "accountId", "status", "updatedAt");
CREATE INDEX "commercial_contracts_contact_status_idx" ON "commercial_contracts"("workspaceId", "primaryContactId", "status");
CREATE INDEX "commercial_contracts_end_status_idx" ON "commercial_contracts"("workspaceId", "effectiveEndsAt", "status");
CREATE UNIQUE INDEX "contract_versions_workspaceId_id_key" ON "contract_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_versions_contract_number_key" ON "contract_versions"("workspaceId", "contractId", "versionNumber");
CREATE UNIQUE INDEX "contract_versions_contract_id_key" ON "contract_versions"("workspaceId", "contractId", "id");
CREATE UNIQUE INDEX "contract_versions_one_current_idx" ON "contract_versions"("workspaceId", "contractId") WHERE "state" IN ('DRAFT','ISSUED');
CREATE INDEX "contract_versions_contract_state_idx" ON "contract_versions"("workspaceId", "contractId", "state");
CREATE INDEX "contract_versions_offer_idx" ON "contract_versions"("workspaceId", "sourceOfferId");
CREATE INDEX "contract_versions_template_idx" ON "contract_versions"("workspaceId", "templateVersionId");
CREATE UNIQUE INDEX "contract_line_snapshots_workspaceId_id_key" ON "contract_line_snapshots"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_line_snapshots_version_position_key" ON "contract_line_snapshots"("workspaceId", "contractVersionId", "position");
CREATE INDEX "contract_line_snapshots_product_idx" ON "contract_line_snapshots"("workspaceId", "productId", "createdAt");
CREATE INDEX "contract_line_snapshots_offer_idx" ON "contract_line_snapshots"("workspaceId", "sourceOfferId");
CREATE UNIQUE INDEX "contract_clause_snapshots_workspaceId_id_key" ON "contract_clause_snapshots"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_clause_snapshots_version_position_key" ON "contract_clause_snapshots"("workspaceId", "contractVersionId", "position");
CREATE UNIQUE INDEX "contract_events_workspaceId_id_key" ON "contract_events"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_events_workspaceId_idempotencyKey_key" ON "contract_events"("workspaceId", "idempotencyKey");
CREATE INDEX "contract_events_contract_time_idx" ON "contract_events"("workspaceId", "contractId", "occurredAt");
CREATE INDEX "contract_events_version_time_idx" ON "contract_events"("workspaceId", "contractVersionId", "occurredAt");
CREATE INDEX "contract_events_type_time_idx" ON "contract_events"("workspaceId", "eventType", "occurredAt");
CREATE UNIQUE INDEX "contract_templates_workspaceId_id_key" ON "contract_templates"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_templates_workspaceId_key_key" ON "contract_templates"("workspaceId", "key");
CREATE INDEX "contract_templates_status_idx" ON "contract_templates"("workspaceId", "status", "deletedAt");
CREATE UNIQUE INDEX "contract_template_versions_workspaceId_id_key" ON "contract_template_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_template_versions_template_version_key" ON "contract_template_versions"("workspaceId", "templateId", "version");
CREATE UNIQUE INDEX "contract_template_versions_template_id_key" ON "contract_template_versions"("workspaceId", "templateId", "id");
CREATE UNIQUE INDEX "contract_template_clauses_workspaceId_id_key" ON "contract_template_clauses"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_template_clauses_version_position_key" ON "contract_template_clauses"("workspaceId", "templateVersionId", "position");
CREATE UNIQUE INDEX "contract_backfill_runs_workspaceId_id_key" ON "contract_backfill_runs"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_backfill_runs_workspaceId_runKey_key" ON "contract_backfill_runs"("workspaceId", "runKey");
CREATE INDEX "contract_backfill_runs_status_idx" ON "contract_backfill_runs"("workspaceId", "status", "startedAt");
CREATE UNIQUE INDEX "contract_backfill_items_workspaceId_id_key" ON "contract_backfill_items"("workspaceId", "id");
CREATE UNIQUE INDEX "contract_backfill_items_run_opportunity_key" ON "contract_backfill_items"("workspaceId", "runId", "opportunityId");
CREATE INDEX "contract_backfill_items_opportunity_action_idx" ON "contract_backfill_items"("workspaceId", "opportunityId", "action");

ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_opportunity_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_account_fkey" FOREIGN KEY ("workspaceId", "accountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_contact_fkey" FOREIGN KEY ("workspaceId", "primaryContactId") REFERENCES "contacts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_owner_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_updated_actor_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_number_sequences" ADD CONSTRAINT "contract_number_sequences_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_fkey" FOREIGN KEY ("workspaceId", "contractId") REFERENCES "commercial_contracts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_offer_fkey" FOREIGN KEY ("workspaceId", "sourceOfferId") REFERENCES "offers"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_issued_actor_fkey" FOREIGN KEY ("workspaceId", "issuedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_line_snapshots" ADD CONSTRAINT "contract_lines_version_fkey" FOREIGN KEY ("workspaceId", "contractVersionId") REFERENCES "contract_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_line_snapshots" ADD CONSTRAINT "contract_lines_offer_fkey" FOREIGN KEY ("workspaceId", "sourceOfferId") REFERENCES "offers"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_line_snapshots" ADD CONSTRAINT "contract_lines_offer_template_fkey" FOREIGN KEY ("workspaceId", "sourceOfferTemplateId") REFERENCES "offer_templates"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_line_snapshots" ADD CONSTRAINT "contract_lines_product_fkey" FOREIGN KEY ("workspaceId", "productId") REFERENCES "products"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_clause_snapshots" ADD CONSTRAINT "contract_clauses_version_fkey" FOREIGN KEY ("workspaceId", "contractVersionId") REFERENCES "contract_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_contract_fkey" FOREIGN KEY ("workspaceId", "contractId") REFERENCES "commercial_contracts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_version_fkey" FOREIGN KEY ("workspaceId", "contractVersionId") REFERENCES "contract_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_events" ADD CONSTRAINT "contract_events_actor_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_updated_actor_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_template_fkey" FOREIGN KEY ("workspaceId", "templateId") REFERENCES "contract_templates"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_created_actor_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_template_clauses" ADD CONSTRAINT "contract_template_clauses_version_fkey" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "contract_template_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_backfill_runs" ADD CONSTRAINT "contract_backfill_runs_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "contract_backfill_runs" ADD CONSTRAINT "contract_backfill_runs_actor_fkey" FOREIGN KEY ("workspaceId", "requestedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_backfill_items" ADD CONSTRAINT "contract_backfill_items_run_fkey" FOREIGN KEY ("workspaceId", "runId") REFERENCES "contract_backfill_runs"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_backfill_items" ADD CONSTRAINT "contract_backfill_items_opportunity_fkey" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_template_fkey" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "contract_template_versions"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commercial_contracts" ADD CONSTRAINT "commercial_contracts_current_version_fkey" FOREIGN KEY ("workspaceId", "id", "currentVersionId") REFERENCES "contract_versions"("workspaceId", "contractId", "id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION prevent_contract_fact_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'contract historical facts are append-only'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_lines_append_only BEFORE UPDATE OR DELETE ON "contract_line_snapshots" FOR EACH ROW EXECUTE FUNCTION prevent_contract_fact_mutation();
CREATE TRIGGER contract_clauses_append_only BEFORE UPDATE OR DELETE ON "contract_clause_snapshots" FOR EACH ROW EXECUTE FUNCTION prevent_contract_fact_mutation();
CREATE TRIGGER contract_events_append_only BEFORE UPDATE OR DELETE ON "contract_events" FOR EACH ROW EXECUTE FUNCTION prevent_contract_fact_mutation();
CREATE TRIGGER contract_template_versions_append_only BEFORE UPDATE OR DELETE ON "contract_template_versions" FOR EACH ROW EXECUTE FUNCTION prevent_contract_fact_mutation();
CREATE TRIGGER contract_template_clauses_append_only BEFORE UPDATE OR DELETE ON "contract_template_clauses" FOR EACH ROW EXECUTE FUNCTION prevent_contract_fact_mutation();
CREATE TRIGGER contract_backfill_items_append_only BEFORE UPDATE OR DELETE ON "contract_backfill_items" FOR EACH ROW EXECUTE FUNCTION prevent_contract_fact_mutation();

CREATE FUNCTION protect_issued_contract_version() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'contract versions cannot be deleted'; END IF;
  IF OLD."state" <> 'DRAFT' THEN
    IF NOT (OLD."state" = 'ISSUED' AND NEW."state" = 'SUPERSEDED' AND (to_jsonb(NEW) - 'state') = (to_jsonb(OLD) - 'state')) THEN
      RAISE EXCEPTION 'issued contract version content is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER contract_versions_immutable_after_issue BEFORE UPDATE OR DELETE ON "contract_versions" FOR EACH ROW EXECUTE FUNCTION protect_issued_contract_version();
