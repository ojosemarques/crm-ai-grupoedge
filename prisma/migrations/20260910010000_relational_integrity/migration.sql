-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_workspaceId_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "customer_handoffs" DROP CONSTRAINT "customer_handoffs_workspaceId_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_workspaceId_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "notes" DROP CONSTRAINT "notes_workspaceId_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_workspaceId_opportunityId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_workspaceId_leadId_id_key" ON "opportunities"("workspaceId", "leadId", "id");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspaceId_leadId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "leadId", "opportunityId") REFERENCES "opportunities"("workspaceId", "leadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_leadId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "leadId", "opportunityId") REFERENCES "opportunities"("workspaceId", "leadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_leadId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "leadId", "opportunityId") REFERENCES "opportunities"("workspaceId", "leadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspaceId_leadId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "leadId", "opportunityId") REFERENCES "opportunities"("workspaceId", "leadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_leadId_opportunityId_fkey" FOREIGN KEY ("workspaceId", "leadId", "opportunityId") REFERENCES "opportunities"("workspaceId", "leadId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Active-record uniqueness. These partial indexes allow a business key to be
-- reused only after the former record has been soft-deleted.
CREATE UNIQUE INDEX "roles_workspace_key_active_key"
  ON "roles" ("workspaceId", lower("key"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "teams_workspace_name_active_key"
  ON "teams" ("workspaceId", lower("name"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "lead_sources_workspace_key_active_key"
  ON "lead_sources" ("workspaceId", lower("key"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "campaigns_workspace_external_ref_active_key"
  ON "acquisition_campaigns" ("workspaceId", "externalRef")
  WHERE "deletedAt" IS NULL AND "externalRef" IS NOT NULL;

CREATE UNIQUE INDEX "creatives_workspace_campaign_external_ref_active_key"
  ON "acquisition_creatives" ("workspaceId", "campaignId", "externalRef")
  WHERE "deletedAt" IS NULL AND "externalRef" IS NOT NULL;

CREATE UNIQUE INDEX "queues_workspace_key_active_key"
  ON "queues" ("workspaceId", lower("key"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "queues_one_general_active_key"
  ON "queues" ("workspaceId")
  WHERE "isGeneral" = true AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "leads_workspace_phone_active_key"
  ON "leads" ("workspaceId", "normalizedPhone")
  WHERE "deletedAt" IS NULL AND "normalizedPhone" IS NOT NULL;

CREATE UNIQUE INDEX "pipelines_workspace_name_active_key"
  ON "pipelines" ("workspaceId", lower("name"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "pipelines_one_default_per_entity_active_key"
  ON "pipelines" ("workspaceId", "entityType")
  WHERE "isDefault" = true AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "pipeline_stages_position_active_key"
  ON "pipeline_stages" ("workspaceId", "pipelineId", "position")
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "pipeline_stages_name_active_key"
  ON "pipeline_stages" ("workspaceId", "pipelineId", lower("name"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "products_workspace_sku_active_key"
  ON "products" ("workspaceId", lower("sku"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "tags_workspace_name_active_key"
  ON "tags" ("workspaceId", lower("name"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "lead_tags_active_key"
  ON "lead_tags" ("workspaceId", "leadId", "tagId")
  WHERE "removedAt" IS NULL;

CREATE UNIQUE INDEX "stage_history_one_open_lead_key"
  ON "stage_history" ("workspaceId", "leadId")
  WHERE "leadId" IS NOT NULL AND "exitedAt" IS NULL;

CREATE UNIQUE INDEX "stage_history_one_open_opportunity_key"
  ON "stage_history" ("workspaceId", "opportunityId")
  WHERE "opportunityId" IS NOT NULL AND "exitedAt" IS NULL;

-- Structural checks that Prisma's schema language cannot currently express.
ALTER TABLE "actors"
  ADD CONSTRAINT "actors_human_user_check"
  CHECK (
    ("type" = 'HUMAN' AND "userId" IS NOT NULL)
    OR ("type" <> 'HUMAN' AND "userId" IS NULL)
  );

ALTER TABLE "acquisition_campaigns"
  ADD CONSTRAINT "campaigns_date_order_check"
  CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_responsibility_xor_check"
  CHECK (("ownerMemberId" IS NOT NULL) <> ("queueId" IS NOT NULL)),
  ADD CONSTRAINT "leads_phone_e164_check"
  CHECK ("normalizedPhone" IS NULL OR "normalizedPhone" ~ '^\\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "leads_campaign_creative_check"
  CHECK ("creativeId" IS NULL OR "campaignId" IS NOT NULL),
  ADD CONSTRAINT "leads_sla_order_check"
  CHECK ("slaDueAt" >= "slaStartedAt"),
  ADD CONSTRAINT "leads_first_response_order_check"
  CHECK ("firstRespondedAt" IS NULL OR "firstRespondedAt" >= "slaStartedAt"),
  ADD CONSTRAINT "leads_next_action_description_check"
  CHECK (length(btrim("nextActionDescription")) > 0);

ALTER TABLE "lead_form_submissions"
  ADD CONSTRAINT "submissions_phone_e164_check"
  CHECK ("normalizedPhone" IS NULL OR "normalizedPhone" ~ '^\\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "submissions_campaign_creative_check"
  CHECK ("creativeId" IS NULL OR "campaignId" IS NOT NULL);

ALTER TABLE "lead_scores"
  ADD CONSTRAINT "lead_scores_range_check"
  CHECK ("score" BETWEEN 0 AND 100);

ALTER TABLE "pipeline_stages"
  ADD CONSTRAINT "pipeline_stages_position_check"
  CHECK ("position" >= 0);

ALTER TABLE "stage_history"
  ADD CONSTRAINT "stage_history_target_xor_check"
  CHECK (("leadId" IS NOT NULL) <> ("opportunityId" IS NOT NULL)),
  ADD CONSTRAINT "stage_history_time_order_check"
  CHECK ("exitedAt" IS NULL OR "exitedAt" > "enteredAt"),
  ADD CONSTRAINT "stage_history_exit_actor_check"
  CHECK (("exitedAt" IS NULL) = ("exitedByActorId" IS NULL));

ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_amount_check"
  CHECK ("amountCents" >= 0),
  ADD CONSTRAINT "opportunities_probability_check"
  CHECK ("probabilityBps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "opportunities_closed_state_check"
  CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL)
    OR ("status" <> 'OPEN' AND "closedAt" IS NOT NULL)
  );

ALTER TABLE "products"
  ADD CONSTRAINT "products_list_price_check"
  CHECK ("listPriceCents" >= 0);

ALTER TABLE "offers"
  ADD CONSTRAINT "offers_quantity_check"
  CHECK ("quantity" > 0),
  ADD CONSTRAINT "offers_money_check"
  CHECK (
    "unitPriceCents" >= 0
    AND "discountCents" >= 0
    AND "totalCents" >= 0
    AND "totalCents" = ("quantity"::bigint * "unitPriceCents") - "discountCents"
  );

ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_time_order_check"
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_duration_check"
  CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_responsibility_xor_check"
  CHECK (("assigneeMemberId" IS NOT NULL) <> ("queueId" IS NOT NULL)),
  ADD CONSTRAINT "tasks_completion_state_check"
  CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  );

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_responsibility_xor_check"
  CHECK (("assigneeMemberId" IS NOT NULL) <> ("queueId" IS NOT NULL));

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_soft_delete_actor_check"
  CHECK (("deletedAt" IS NULL) = ("deletedByActorId" IS NULL));

ALTER TABLE "lead_tags"
  ADD CONSTRAINT "lead_tags_removal_actor_check"
  CHECK (("removedAt" IS NULL) = ("removedByActorId" IS NULL));

ALTER TABLE "automation_runs"
  ADD CONSTRAINT "automation_runs_time_order_check"
  CHECK (
    ("startedAt" IS NULL OR "startedAt" >= "triggeredAt")
    AND ("finishedAt" IS NULL OR ("startedAt" IS NOT NULL AND "finishedAt" >= "startedAt"))
  );

ALTER TABLE "ai_insights"
  ADD CONSTRAINT "ai_insights_target_check"
  CHECK (
    ("targetType" = 'WORKSPACE' AND "leadId" IS NULL AND "opportunityId" IS NULL)
    OR ("targetType" = 'LEAD' AND "leadId" IS NOT NULL AND "opportunityId" IS NULL)
    OR ("targetType" = 'OPPORTUNITY' AND "leadId" IS NULL AND "opportunityId" IS NOT NULL)
  ),
  ADD CONSTRAINT "ai_insights_confirmation_check"
  CHECK (("confirmedAt" IS NULL) = ("confirmedByActorId" IS NULL));

ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_counts_check"
  CHECK (
    "totalRows" >= 0
    AND "processedRows" >= 0
    AND "succeededRows" >= 0
    AND "failedRows" >= 0
    AND "processedRows" = "succeededRows" + "failedRows"
    AND "processedRows" <= "totalRows"
  ),
  ADD CONSTRAINT "import_jobs_time_order_check"
  CHECK (
    ("startedAt" IS NULL OR "startedAt" >= "createdAt")
    AND ("finishedAt" IS NULL OR ("startedAt" IS NOT NULL AND "finishedAt" >= "startedAt"))
  );

ALTER TABLE "customer_handoffs"
  ADD CONSTRAINT "customer_handoffs_target_xor_check"
  CHECK (("toMemberId" IS NOT NULL) <> ("toQueueId" IS NOT NULL)),
  ADD CONSTRAINT "customer_handoffs_time_order_check"
  CHECK (
    ("acceptedAt" IS NULL OR "acceptedAt" >= "requestedAt")
    AND ("completedAt" IS NULL OR ("acceptedAt" IS NOT NULL AND "completedAt" >= "acceptedAt"))
  );

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_attempts_check"
  CHECK ("attempts" >= 0 AND "maxAttempts" > 0 AND "attempts" <= "maxAttempts"),
  ADD CONSTRAINT "jobs_priority_check"
  CHECK ("priority" >= 0);

-- Enforce the pipeline discriminator in the database, not only in services.
CREATE FUNCTION "enforce_pipeline_entity_type"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actual_type "PipelineEntityType";
  expected_type "PipelineEntityType";
BEGIN
  expected_type := CASE TG_TABLE_NAME
    WHEN 'leads' THEN 'LEAD'::"PipelineEntityType"
    WHEN 'opportunities' THEN 'OPPORTUNITY'::"PipelineEntityType"
  END;

  SELECT "entityType"
    INTO actual_type
    FROM "pipelines"
    WHERE "workspaceId" = NEW."workspaceId" AND "id" = NEW."pipelineId";

  IF actual_type IS NOT NULL AND actual_type <> expected_type THEN
    RAISE EXCEPTION 'pipeline type % is invalid for %', actual_type, TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "leads_pipeline_type_trigger"
  BEFORE INSERT OR UPDATE OF "workspaceId", "pipelineId" ON "leads"
  FOR EACH ROW EXECUTE FUNCTION "enforce_pipeline_entity_type"();

CREATE TRIGGER "opportunities_pipeline_type_trigger"
  BEFORE INSERT OR UPDATE OF "workspaceId", "pipelineId" ON "opportunities"
  FOR EACH ROW EXECUTE FUNCTION "enforce_pipeline_entity_type"();

-- A human actor must map to an active membership in the same workspace.
CREATE FUNCTION "enforce_human_actor_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."type" = 'HUMAN'
    AND NOT EXISTS (
      SELECT 1
      FROM "workspace_members"
      WHERE "workspaceId" = NEW."workspaceId"
        AND "userId" = NEW."userId"
        AND "status" = 'ACTIVE'
        AND "deletedAt" IS NULL
    )
  THEN
    RAISE EXCEPTION 'human actor requires an active membership in the same workspace'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "actors_human_membership_trigger"
  AFTER INSERT OR UPDATE OF "workspaceId", "type", "userId" ON "actors"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "enforce_human_actor_membership"();

-- Audit records are append-only even when SQL bypasses the application layer.
CREATE FUNCTION "prevent_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_logs_no_update_or_delete_trigger"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "prevent_audit_log_mutation"();

CREATE TRIGGER "audit_logs_no_truncate_trigger"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_audit_log_mutation"();
