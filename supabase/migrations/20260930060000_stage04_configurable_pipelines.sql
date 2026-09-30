SET search_path TO crm, public;
-- CreateEnum
CREATE TYPE "PipelineTemplateEditMode" AS ENUM ('SHARED', 'LOCAL_COPY');

-- CreateEnum
CREATE TYPE "PipelineTemplateMigrationStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'ROLLED_BACK', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OpportunityBulkAction" AS ENUM ('REASSIGN', 'TRANSITION');

-- CreateEnum
CREATE TYPE "OpportunityBulkStatus" AS ENUM ('PREVIEWED', 'EXECUTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "pipeline_origin_groups" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipeline_origin_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_origin_group_sources" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_origin_group_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_origin_access_rules" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "canRead" BOOLEAN NOT NULL DEFAULT true,
    "canDistribute" BOOLEAN NOT NULL DEFAULT false,
    "canReassign" BOOLEAN NOT NULL DEFAULT false,
    "canTransition" BOOLEAN NOT NULL DEFAULT true,
    "createdByActorId" UUID NOT NULL,
    "updatedByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipeline_origin_access_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_templates" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" "PipelineEntityType" NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "pipeline_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_template_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "previousVersionId" UUID,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_template_stages" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "stableKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "StageType" NOT NULL DEFAULT 'OPEN',
    "leadStageCode" "LeadPipelineStageCode",
    "opportunityStageCode" "OpportunityPipelineStageCode",

    CONSTRAINT "pipeline_template_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_template_activity_definitions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "activityType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "script" TEXT,
    "dueOffsetDays" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pipeline_template_activity_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_required_fields" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "offerTemplateId" UUID,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_required_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_template_applications" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "editMode" "PipelineTemplateEditMode" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "appliedByActorId" UUID NOT NULL,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipeline_template_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_template_migrations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "pipelineId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "fromTemplateVersionId" UUID NOT NULL,
    "toTemplateVersionId" UUID NOT NULL,
    "status" "PipelineTemplateMigrationStatus" NOT NULL DEFAULT 'PREVIEWED',
    "stageMapping" JSONB NOT NULL,
    "affectedCards" JSONB NOT NULL,
    "rollbackSnapshot" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "expectedPipelineAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "appliedAt" TIMESTAMPTZ(3),
    "rolledBackAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_template_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_bulk_operations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "action" "OpportunityBulkAction" NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "OpportunityBulkStatus" NOT NULL DEFAULT 'PREVIEWED',
    "expectedCount" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "executedAt" TIMESTAMPTZ(3),
    "createdByActorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_bulk_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_bulk_operation_items" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "previousOwnerId" UUID NOT NULL,
    "previousStageId" UUID NOT NULL,
    "resultingRevision" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_bulk_operation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_origin_groups_workspaceId_teamId_active_idx" ON "pipeline_origin_groups"("workspaceId", "teamId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_origin_groups_workspaceId_id_key" ON "pipeline_origin_groups"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_origin_groups_workspaceId_name_key" ON "pipeline_origin_groups"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_origin_group_sources_workspaceId_id_key" ON "pipeline_origin_group_sources"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_origin_group_sources_workspaceId_groupId_sourceId_key" ON "pipeline_origin_group_sources"("workspaceId", "groupId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_origin_group_sources_workspaceId_sourceId_key" ON "pipeline_origin_group_sources"("workspaceId", "sourceId");

-- CreateIndex
CREATE INDEX "pipeline_origin_access_rules_workspaceId_teamId_canRead_idx" ON "pipeline_origin_access_rules"("workspaceId", "teamId", "canRead");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_origin_access_rules_workspaceId_id_key" ON "pipeline_origin_access_rules"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_origin_access_rules_workspaceId_sourceId_teamId_key" ON "pipeline_origin_access_rules"("workspaceId", "sourceId", "teamId");

-- CreateIndex
CREATE INDEX "pipeline_templates_workspaceId_entityType_archivedAt_idx" ON "pipeline_templates"("workspaceId", "entityType", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_templates_workspaceId_id_key" ON "pipeline_templates"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_templates_workspaceId_key_key" ON "pipeline_templates"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "pipeline_template_versions_workspaceId_previousVersionId_idx" ON "pipeline_template_versions"("workspaceId", "previousVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_versions_workspaceId_id_key" ON "pipeline_template_versions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_versions_workspaceId_templateId_version_key" ON "pipeline_template_versions"("workspaceId", "templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_stages_workspaceId_id_key" ON "pipeline_template_stages"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_stages_workspaceId_templateVersionId_stab_key" ON "pipeline_template_stages"("workspaceId", "templateVersionId", "stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_stages_workspaceId_templateVersionId_posi_key" ON "pipeline_template_stages"("workspaceId", "templateVersionId", "position");

-- CreateIndex
CREATE INDEX "pipeline_template_activity_definitions_workspaceId_template_idx" ON "pipeline_template_activity_definitions"("workspaceId", "templateVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_activity_definitions_workspaceId_id_key" ON "pipeline_template_activity_definitions"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_activity_definitions_workspaceId_stageId__key" ON "pipeline_template_activity_definitions"("workspaceId", "stageId", "position");

-- CreateIndex
CREATE INDEX "pipeline_required_fields_workspaceId_templateVersionId_idx" ON "pipeline_required_fields"("workspaceId", "templateVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_required_fields_workspaceId_id_key" ON "pipeline_required_fields"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_required_fields_workspaceId_stageId_offerTemplateI_key" ON "pipeline_required_fields"("workspaceId", "stageId", "offerTemplateId", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_applications_pipelineId_key" ON "pipeline_template_applications"("pipelineId");

-- CreateIndex
CREATE INDEX "pipeline_template_applications_workspaceId_templateVersionI_idx" ON "pipeline_template_applications"("workspaceId", "templateVersionId", "editMode");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_applications_workspaceId_id_key" ON "pipeline_template_applications"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_applications_workspaceId_pipelineId_key" ON "pipeline_template_applications"("workspaceId", "pipelineId");

-- CreateIndex
CREATE INDEX "pipeline_template_migrations_workspaceId_pipelineId_status__idx" ON "pipeline_template_migrations"("workspaceId", "pipelineId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_migrations_workspaceId_id_key" ON "pipeline_template_migrations"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_template_migrations_workspaceId_fingerprint_key" ON "pipeline_template_migrations"("workspaceId", "fingerprint");

-- CreateIndex
CREATE INDEX "opportunity_bulk_operations_workspaceId_status_createdAt_idx" ON "opportunity_bulk_operations"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_bulk_operations_workspaceId_id_key" ON "opportunity_bulk_operations"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_bulk_operations_workspaceId_fingerprint_key" ON "opportunity_bulk_operations"("workspaceId", "fingerprint");

-- CreateIndex
CREATE INDEX "opportunity_bulk_operation_items_workspaceId_opportunityId_idx" ON "opportunity_bulk_operation_items"("workspaceId", "opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_bulk_operation_items_workspaceId_id_key" ON "opportunity_bulk_operation_items"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_bulk_operation_items_workspaceId_operationId_op_key" ON "opportunity_bulk_operation_items"("workspaceId", "operationId", "opportunityId");

-- AddForeignKey
ALTER TABLE "pipeline_origin_groups" ADD CONSTRAINT "pipeline_origin_groups_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_origin_group_sources" ADD CONSTRAINT "pipeline_origin_group_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_origin_group_sources" ADD CONSTRAINT "pipeline_origin_group_sources_workspaceId_groupId_fkey" FOREIGN KEY ("workspaceId", "groupId") REFERENCES "pipeline_origin_groups"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_origin_access_rules" ADD CONSTRAINT "pipeline_origin_access_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_templates" ADD CONSTRAINT "pipeline_templates_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_versions" ADD CONSTRAINT "pipeline_template_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_versions" ADD CONSTRAINT "pipeline_template_versions_workspaceId_templateId_fkey" FOREIGN KEY ("workspaceId", "templateId") REFERENCES "pipeline_templates"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_stages" ADD CONSTRAINT "pipeline_template_stages_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_stages" ADD CONSTRAINT "pipeline_template_stages_workspaceId_templateVersionId_fkey" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "pipeline_template_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_activity_definitions" ADD CONSTRAINT "pipeline_template_activity_definitions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_activity_definitions" ADD CONSTRAINT "pipeline_template_activity_definitions_workspaceId_templat_fkey" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "pipeline_template_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_activity_definitions" ADD CONSTRAINT "pipeline_template_activity_definitions_workspaceId_stageId_fkey" FOREIGN KEY ("workspaceId", "stageId") REFERENCES "pipeline_template_stages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_required_fields" ADD CONSTRAINT "pipeline_required_fields_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_required_fields" ADD CONSTRAINT "pipeline_required_fields_workspaceId_templateVersionId_fkey" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "pipeline_template_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_required_fields" ADD CONSTRAINT "pipeline_required_fields_workspaceId_stageId_fkey" FOREIGN KEY ("workspaceId", "stageId") REFERENCES "pipeline_template_stages"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_applications" ADD CONSTRAINT "pipeline_template_applications_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_applications" ADD CONSTRAINT "pipeline_template_applications_workspaceId_pipelineId_fkey" FOREIGN KEY ("workspaceId", "pipelineId") REFERENCES "pipelines"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_applications" ADD CONSTRAINT "pipeline_template_applications_workspaceId_templateVersion_fkey" FOREIGN KEY ("workspaceId", "templateVersionId") REFERENCES "pipeline_template_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_migrations" ADD CONSTRAINT "pipeline_template_migrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_migrations" ADD CONSTRAINT "pipeline_template_migrations_workspaceId_pipelineId_fkey" FOREIGN KEY ("workspaceId", "pipelineId") REFERENCES "pipelines"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_migrations" ADD CONSTRAINT "pipeline_template_migrations_workspaceId_applicationId_fkey" FOREIGN KEY ("workspaceId", "applicationId") REFERENCES "pipeline_template_applications"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_migrations" ADD CONSTRAINT "pipeline_template_migrations_workspaceId_fromTemplateVersi_fkey" FOREIGN KEY ("workspaceId", "fromTemplateVersionId") REFERENCES "pipeline_template_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_template_migrations" ADD CONSTRAINT "pipeline_template_migrations_workspaceId_toTemplateVersion_fkey" FOREIGN KEY ("workspaceId", "toTemplateVersionId") REFERENCES "pipeline_template_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_bulk_operations" ADD CONSTRAINT "opportunity_bulk_operations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_bulk_operation_items" ADD CONSTRAINT "opportunity_bulk_operation_items_workspaceId_operationId_fkey" FOREIGN KEY ("workspaceId", "operationId") REFERENCES "opportunity_bulk_operations"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "pipeline_origin_groups" ADD CONSTRAINT "pipeline_origin_groups_team_fkey" FOREIGN KEY ("workspaceId","teamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "pipeline_origin_group_sources" ADD CONSTRAINT "pipeline_origin_group_sources_source_fkey" FOREIGN KEY ("workspaceId","sourceId") REFERENCES "lead_sources"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "pipeline_origin_access_rules" ADD CONSTRAINT "pipeline_origin_access_rules_source_fkey" FOREIGN KEY ("workspaceId","sourceId") REFERENCES "lead_sources"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "pipeline_origin_access_rules" ADD CONSTRAINT "pipeline_origin_access_rules_team_fkey" FOREIGN KEY ("workspaceId","teamId") REFERENCES "teams"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "pipeline_required_fields" ADD CONSTRAINT "pipeline_required_fields_offer_template_fkey" FOREIGN KEY ("workspaceId","offerTemplateId") REFERENCES "offer_templates"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "opportunity_bulk_operation_items" ADD CONSTRAINT "opportunity_bulk_operation_items_opportunity_fkey" FOREIGN KEY ("workspaceId","opportunityId") REFERENCES "opportunities"("workspaceId","id") ON DELETE RESTRICT;

ALTER TABLE "pipeline_template_versions" ADD CONSTRAINT "pipeline_template_versions_version_check" CHECK ("version" > 0);
ALTER TABLE "pipeline_template_stages" ADD CONSTRAINT "pipeline_template_stages_position_check" CHECK ("position" >= 0);
ALTER TABLE "pipeline_template_activity_definitions" ADD CONSTRAINT "pipeline_template_activities_values_check" CHECK ("position" >= 0 AND "dueOffsetDays" >= 0);
ALTER TABLE "pipeline_template_migrations" ADD CONSTRAINT "pipeline_template_migrations_window_check" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "opportunity_bulk_operations" ADD CONSTRAINT "opportunity_bulk_operations_values_check" CHECK (char_length("reason") >= 3 AND "expectedCount" > 0 AND "expiresAt" > "createdAt");

CREATE FUNCTION prevent_pipeline_template_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pipeline template versions are immutable' USING ERRCODE='55000';
END $$;
CREATE TRIGGER pipeline_template_versions_immutable BEFORE UPDATE OR DELETE ON "pipeline_template_versions" FOR EACH ROW EXECUTE FUNCTION prevent_pipeline_template_version_mutation();
CREATE TRIGGER pipeline_template_stages_immutable BEFORE UPDATE OR DELETE ON "pipeline_template_stages" FOR EACH ROW EXECUTE FUNCTION prevent_pipeline_template_version_mutation();
CREATE TRIGGER pipeline_template_activities_immutable BEFORE UPDATE OR DELETE ON "pipeline_template_activity_definitions" FOR EACH ROW EXECUTE FUNCTION prevent_pipeline_template_version_mutation();
CREATE TRIGGER pipeline_required_fields_immutable BEFORE UPDATE OR DELETE ON "pipeline_required_fields" FOR EACH ROW EXECUTE FUNCTION prevent_pipeline_template_version_mutation();

CREATE FUNCTION protect_pipeline_migration_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."workspaceId" <> NEW."workspaceId" OR OLD."pipelineId" <> NEW."pipelineId" OR OLD."applicationId" <> NEW."applicationId"
     OR OLD."fromTemplateVersionId" <> NEW."fromTemplateVersionId" OR OLD."toTemplateVersionId" <> NEW."toTemplateVersionId"
     OR OLD."stageMapping" <> NEW."stageMapping" OR OLD."affectedCards" <> NEW."affectedCards"
     OR OLD."rollbackSnapshot" <> NEW."rollbackSnapshot" OR OLD."fingerprint" <> NEW."fingerprint"
     OR OLD."expectedPipelineAt" <> NEW."expectedPipelineAt" OR OLD."createdByActorId" <> NEW."createdByActorId" OR OLD."createdAt" <> NEW."createdAt" THEN
    RAISE EXCEPTION 'pipeline migration history is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pipeline_template_migrations_history_guard BEFORE UPDATE ON "pipeline_template_migrations" FOR EACH ROW EXECUTE FUNCTION protect_pipeline_migration_history();

GRANT SELECT,INSERT,UPDATE,DELETE ON crm.pipeline_origin_groups, crm.pipeline_origin_group_sources, crm.pipeline_origin_access_rules, crm.pipeline_templates, crm.pipeline_template_versions, crm.pipeline_template_stages, crm.pipeline_template_activity_definitions, crm.pipeline_required_fields, crm.pipeline_template_applications, crm.pipeline_template_migrations, crm.opportunity_bulk_operations, crm.opportunity_bulk_operation_items TO crm_politizai_runtime;

INSERT INTO crm._prisma_migrations (id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count) SELECT '63000500-0000-4000-8000-000000000004','db561f4e252b7b09df915283956e220a1212c29a0f3d7e68e6f3e8c8fdf62a20',CURRENT_TIMESTAMP,'20260930050000_stage04_configurable_pipelines',NULL,NULL,CURRENT_TIMESTAMP,1 WHERE NOT EXISTS (SELECT 1 FROM crm._prisma_migrations WHERE migration_name='20260930050000_stage04_configurable_pipelines');
