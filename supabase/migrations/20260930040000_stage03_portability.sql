SET search_path TO crm, public;
CREATE TYPE "CommercialEntityType" AS ENUM ('CONTACT','ACCOUNT','LEAD','OPPORTUNITY');
CREATE TYPE "CustomFieldDataType" AS ENUM ('TEXT','NUMBER','BOOLEAN','DATE','SELECT','MULTI_SELECT');
CREATE TYPE "PortabilityBulkAction" AS ENUM ('ADD_TAG','REMOVE_TAG','SET_CUSTOM_FIELD');
CREATE TYPE "PortabilityBulkStatus" AS ENUM ('PREVIEWED','EXECUTED','EXPIRED');
ALTER TYPE "LeadIntakeChannel" ADD VALUE IF NOT EXISTS 'FORM';
ALTER TYPE "LeadIntakeChannel" ADD VALUE IF NOT EXISTS 'LANDING_PAGE';
ALTER TYPE "LeadIntakeChannel" ADD VALUE IF NOT EXISTS 'AD';
DROP INDEX "leads_workspace_phone_active_key";
CREATE INDEX "leads_workspace_phone_active_idx" ON "leads"("workspaceId", "normalizedPhone") WHERE "deletedAt" IS NULL;
ALTER TABLE "lead_form_submissions" ADD COLUMN "requestedCatalogItemId" uuid, ADD COLUMN "requestedCatalogVersion" integer;
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_requested_catalog_pair_check" CHECK (("requestedCatalogItemId" IS NULL) = ("requestedCatalogVersion" IS NULL));
ALTER TABLE "lead_form_submissions" ADD CONSTRAINT "lead_form_submissions_requested_catalog_fkey" FOREIGN KEY ("workspaceId","requestedCatalogItemId","requestedCatalogVersion") REFERENCES "products"("workspaceId","catalogItemId","version") ON DELETE RESTRICT;

CREATE TABLE "commercial_entity_tags" ("id" uuid PRIMARY KEY, "workspaceId" uuid NOT NULL, "tagId" uuid NOT NULL, "entityType" "CommercialEntityType" NOT NULL, "entityId" uuid NOT NULL, "createdByActorId" uuid NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(), UNIQUE("workspaceId","tagId","entityType","entityId"));
CREATE INDEX "commercial_entity_tags_workspaceId_entityType_entityId_idx" ON "commercial_entity_tags"("workspaceId","entityType","entityId");
ALTER TABLE "commercial_entity_tags" ADD CONSTRAINT "commercial_entity_tags_tag_fkey" FOREIGN KEY ("workspaceId","tagId") REFERENCES "tags"("workspaceId","id") ON DELETE RESTRICT;

CREATE TABLE "custom_field_definitions" ("id" uuid PRIMARY KEY, "workspaceId" uuid NOT NULL, "entityType" "CommercialEntityType" NOT NULL, "key" text NOT NULL, "name" text NOT NULL, "dataType" "CustomFieldDataType" NOT NULL, "options" jsonb, "required" boolean NOT NULL DEFAULT false, "active" boolean NOT NULL DEFAULT true, "revision" integer NOT NULL DEFAULT 1, "createdByActorId" uuid NOT NULL, "updatedByActorId" uuid NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "updatedAt" timestamptz(3) NOT NULL, UNIQUE("workspaceId","id"), UNIQUE("workspaceId","entityType","key"));
CREATE INDEX "custom_field_definitions_workspaceId_entityType_active_idx" ON "custom_field_definitions"("workspaceId","entityType","active");
CREATE TABLE "custom_field_values" ("id" uuid PRIMARY KEY, "workspaceId" uuid NOT NULL, "definitionId" uuid NOT NULL, "entityType" "CommercialEntityType" NOT NULL, "entityId" uuid NOT NULL, "value" jsonb NOT NULL, "revision" integer NOT NULL DEFAULT 1, "updatedByActorId" uuid NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(), "updatedAt" timestamptz(3) NOT NULL, UNIQUE("workspaceId","definitionId","entityType","entityId"));
CREATE INDEX "custom_field_values_workspaceId_entityType_entityId_idx" ON "custom_field_values"("workspaceId","entityType","entityId");
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_fkey" FOREIGN KEY ("workspaceId","definitionId") REFERENCES "custom_field_definitions"("workspaceId","id") ON DELETE RESTRICT;

CREATE FUNCTION "validate_commercial_entity_target"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_exists boolean;
BEGIN
  IF TG_TABLE_NAME = 'custom_field_values' AND NOT EXISTS (SELECT 1 FROM "custom_field_definitions" d WHERE d."workspaceId"=NEW."workspaceId" AND d.id=NEW."definitionId" AND d."entityType"=NEW."entityType" AND d.active) THEN RAISE EXCEPTION 'custom field definition/entity mismatch' USING ERRCODE='23514'; END IF;
  CASE NEW."entityType"
    WHEN 'CONTACT' THEN SELECT EXISTS(SELECT 1 FROM "contacts" e WHERE e.id=NEW."entityId" AND e."workspaceId"=NEW."workspaceId" AND e."deletedAt" IS NULL) INTO target_exists;
    WHEN 'ACCOUNT' THEN SELECT EXISTS(SELECT 1 FROM "accounts" e WHERE e.id=NEW."entityId" AND e."workspaceId"=NEW."workspaceId" AND e."deletedAt" IS NULL) INTO target_exists;
    WHEN 'LEAD' THEN SELECT EXISTS(SELECT 1 FROM "leads" e WHERE e.id=NEW."entityId" AND e."workspaceId"=NEW."workspaceId" AND e."deletedAt" IS NULL) INTO target_exists;
    WHEN 'OPPORTUNITY' THEN SELECT EXISTS(SELECT 1 FROM "opportunities" e WHERE e.id=NEW."entityId" AND e."workspaceId"=NEW."workspaceId" AND e."deletedAt" IS NULL) INTO target_exists;
  END CASE;
  IF NOT target_exists THEN RAISE EXCEPTION 'commercial entity does not belong to workspace' USING ERRCODE='23503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "commercial_entity_tags_target_guard" BEFORE INSERT OR UPDATE ON "commercial_entity_tags" FOR EACH ROW EXECUTE FUNCTION "validate_commercial_entity_target"();
CREATE TRIGGER "custom_field_values_target_guard" BEFORE INSERT OR UPDATE ON "custom_field_values" FOR EACH ROW EXECUTE FUNCTION "validate_commercial_entity_target"();

CREATE TABLE "portability_bulk_operations" ("id" uuid PRIMARY KEY, "workspaceId" uuid NOT NULL, "entityType" "CommercialEntityType" NOT NULL, "action" "PortabilityBulkAction" NOT NULL, "entityIds" jsonb NOT NULL, "payload" jsonb NOT NULL, "fingerprint" text NOT NULL, "reason" text NOT NULL, "expectedCount" integer NOT NULL, "status" "PortabilityBulkStatus" NOT NULL DEFAULT 'PREVIEWED', "previewExpiresAt" timestamptz(3) NOT NULL, "executedAt" timestamptz(3), "createdByActorId" uuid NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(), UNIQUE("workspaceId","id"), UNIQUE("workspaceId","fingerprint"));
CREATE INDEX "portability_bulk_operations_workspaceId_status_createdAt_idx" ON "portability_bulk_operations"("workspaceId","status","createdAt");
CREATE TABLE "portability_bulk_operation_items" ("id" uuid PRIMARY KEY, "workspaceId" uuid NOT NULL, "operationId" uuid NOT NULL, "entityId" uuid NOT NULL, "before" jsonb, "after" jsonb, "status" text NOT NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(), UNIQUE("workspaceId","operationId","entityId"));
CREATE INDEX "portability_bulk_operation_items_workspaceId_entityId_idx" ON "portability_bulk_operation_items"("workspaceId","entityId");
ALTER TABLE "portability_bulk_operation_items" ADD CONSTRAINT "portability_bulk_operation_items_operation_fkey" FOREIGN KEY ("workspaceId","operationId") REFERENCES "portability_bulk_operations"("workspaceId","id") ON DELETE RESTRICT;

INSERT INTO "permissions" ("id","key","description","createdAt") VALUES
 (md5('permission:portability.read')::uuid,'portability.read','Consultar portabilidade comercial',CURRENT_TIMESTAMP),
 (md5('permission:portability.export')::uuid,'portability.export','Exportar contatos e negócios autorizados',CURRENT_TIMESTAMP),
 (md5('permission:portability.manage')::uuid,'portability.manage','Gerenciar tags, campos e ações em massa',CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "role_permissions" ("id","workspaceId","roleId","permissionId","scope","createdByActorId","createdAt")
SELECT md5(r."workspaceId"::text||':'||r.id::text||':'||p.key)::uuid,r."workspaceId",r.id,p.id,'WORKSPACE'::"PermissionScope",r."createdByActorId",CURRENT_TIMESTAMP
FROM "roles" r CROSS JOIN "permissions" p
WHERE r.key IN ('administrator','commercial_manager') AND r."deletedAt" IS NULL AND p.key IN ('portability.read','portability.export','portability.manage')
ON CONFLICT ("workspaceId","roleId","permissionId") DO NOTHING;

GRANT SELECT,INSERT,UPDATE,DELETE ON crm.commercial_entity_tags, crm.custom_field_definitions, crm.custom_field_values, crm.portability_bulk_operations, crm.portability_bulk_operation_items TO crm_politizai_runtime;

INSERT INTO crm._prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT
  '63000300-0000-4000-8000-000000000003',
  '6b05b144fa7c696a0af164cfccd787ee5def937bce05951643656e3208ec25cf',
  CURRENT_TIMESTAMP,
  '20260930030000_stage03_portability',
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  1
WHERE NOT EXISTS (
  SELECT 1
  FROM crm._prisma_migrations
  WHERE migration_name = '20260930030000_stage03_portability'
);
