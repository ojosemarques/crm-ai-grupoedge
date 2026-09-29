-- CRM-60: governed local n8n sandbox. Additive only; no external connector.
CREATE TYPE "N8nMachineStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'REVOKED');
CREATE TYPE "N8nMachineScope" AS ENUM ('EVENTS_READ', 'RECORDS_READ', 'ACTIVITY_DRAFT_CREATE', 'NEXT_ACTION_DRAFT_CREATE', 'AUTOMATION_RESULT_WRITE', 'ACTION_PROPOSAL_CREATE');
CREATE TYPE "N8nRecipeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'REVOKED');
CREATE TYPE "N8nProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');
CREATE TYPE "N8nProposalKind" AS ENUM ('DRAFT_ACTIVITY', 'DRAFT_NEXT_ACTION', 'CONSEQUENTIAL_ACTION');
CREATE TYPE "N8nCommandStatus" AS ENUM ('ACCEPTED', 'DEDUPLICATED', 'REJECTED');

CREATE TABLE "n8n_machine_identities" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "actorId" UUID NOT NULL, "ownerMemberId" UUID NOT NULL,
  "key" TEXT NOT NULL, "name" TEXT NOT NULL, "purpose" TEXT NOT NULL, "status" "N8nMachineStatus" NOT NULL DEFAULT 'DRAFT',
  "tokenHash" TEXT NOT NULL, "tokenFingerprint" TEXT NOT NULL, "tokenVersion" INTEGER NOT NULL DEFAULT 1, "revision" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "lastUsedAt" TIMESTAMPTZ(3), "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL, "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "n8n_machine_identities_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "n8n_machine_permissions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "machineIdentityId" UUID NOT NULL, "scope" "N8nMachineScope" NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "n8n_machine_permissions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "n8n_recipes" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "ownerMemberId" UUID NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL, "purpose" TEXT NOT NULL,
  "status" "N8nRecipeStatus" NOT NULL DEFAULT 'DRAFT', "currentVersion" INTEGER NOT NULL DEFAULT 1, "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL, "revokedAt" TIMESTAMPTZ(3), CONSTRAINT "n8n_recipes_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "n8n_recipe_versions" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "recipeId" UUID NOT NULL, "version" INTEGER NOT NULL, "contractVersion" TEXT NOT NULL,
  "triggerEventType" TEXT NOT NULL, "triggerSchemaVersion" TEXT NOT NULL, "actionKind" TEXT NOT NULL, "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
  "definitionHash" TEXT NOT NULL, "definition" JSONB NOT NULL, "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "n8n_recipe_versions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "n8n_command_receipts" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "machineIdentityId" UUID NOT NULL, "idempotencyKey" TEXT NOT NULL, "nonceHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL, "commandType" TEXT NOT NULL, "status" "N8nCommandStatus" NOT NULL, "responseCode" TEXT NOT NULL, "response" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL, "causationId" TEXT, "causationDepth" INTEGER NOT NULL DEFAULT 0, "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "n8n_command_receipts_pkey" PRIMARY KEY ("id"), CONSTRAINT "n8n_command_receipts_depth_check" CHECK ("causationDepth" BETWEEN 0 AND 4)
);
CREATE TABLE "n8n_action_proposals" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "machineIdentityId" UUID NOT NULL, "recipeId" UUID, "recipeVersionId" UUID,
  "kind" "N8nProposalKind" NOT NULL, "status" "N8nProposalStatus" NOT NULL DEFAULT 'PENDING', "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
  "reason" TEXT NOT NULL, "proposedPayload" JSONB NOT NULL, "payloadHash" TEXT NOT NULL, "expectedVersion" INTEGER, "idempotencyKey" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL, "causationId" TEXT, "causationDepth" INTEGER NOT NULL DEFAULT 0, "reviewedByActorId" UUID, "reviewReason" TEXT,
  "reviewedAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "n8n_action_proposals_pkey" PRIMARY KEY ("id"), CONSTRAINT "n8n_action_proposals_depth_check" CHECK ("causationDepth" BETWEEN 0 AND 4)
);

CREATE UNIQUE INDEX "n8n_machine_identities_workspaceId_id_key" ON "n8n_machine_identities"("workspaceId", "id");
CREATE UNIQUE INDEX "n8n_machine_identities_workspaceId_key_key" ON "n8n_machine_identities"("workspaceId", "key");
CREATE UNIQUE INDEX "n8n_machine_identities_workspaceId_actorId_key" ON "n8n_machine_identities"("workspaceId", "actorId");
CREATE UNIQUE INDEX "n8n_machine_identities_tokenFingerprint_key" ON "n8n_machine_identities"("tokenFingerprint");
CREATE INDEX "n8n_machine_identities_workspaceId_status_expiresAt_idx" ON "n8n_machine_identities"("workspaceId", "status", "expiresAt");
CREATE INDEX "n8n_machine_identities_workspaceId_ownerMemberId_status_idx" ON "n8n_machine_identities"("workspaceId", "ownerMemberId", "status");
CREATE UNIQUE INDEX "n8n_machine_permissions_workspaceId_id_key" ON "n8n_machine_permissions"("workspaceId", "id");
CREATE UNIQUE INDEX "n8n_machine_permissions_workspaceId_machineIdentityId_scope_key" ON "n8n_machine_permissions"("workspaceId", "machineIdentityId", "scope");
CREATE INDEX "n8n_machine_permissions_workspaceId_scope_idx" ON "n8n_machine_permissions"("workspaceId", "scope");
CREATE UNIQUE INDEX "n8n_recipes_workspaceId_id_key" ON "n8n_recipes"("workspaceId", "id");
CREATE UNIQUE INDEX "n8n_recipes_workspaceId_key_key" ON "n8n_recipes"("workspaceId", "key");
CREATE INDEX "n8n_recipes_workspaceId_status_updatedAt_idx" ON "n8n_recipes"("workspaceId", "status", "updatedAt");
CREATE UNIQUE INDEX "n8n_recipe_versions_workspaceId_id_key" ON "n8n_recipe_versions"("workspaceId", "id");
CREATE UNIQUE INDEX "n8n_recipe_versions_workspaceId_recipeId_version_key" ON "n8n_recipe_versions"("workspaceId", "recipeId", "version");
CREATE INDEX "n8n_recipe_versions_workspaceId_triggerEventType_triggerSchemaVersion_idx" ON "n8n_recipe_versions"("workspaceId", "triggerEventType", "triggerSchemaVersion");
CREATE UNIQUE INDEX "n8n_command_receipts_workspaceId_id_key" ON "n8n_command_receipts"("workspaceId", "id");
CREATE UNIQUE INDEX "n8n_command_receipts_workspaceId_machineIdentityId_idempotencyKey_key" ON "n8n_command_receipts"("workspaceId", "machineIdentityId", "idempotencyKey");
CREATE UNIQUE INDEX "n8n_command_receipts_workspaceId_machineIdentityId_nonceHash_key" ON "n8n_command_receipts"("workspaceId", "machineIdentityId", "nonceHash");
CREATE INDEX "n8n_command_receipts_workspaceId_machineIdentityId_status_receivedAt_idx" ON "n8n_command_receipts"("workspaceId", "machineIdentityId", "status", "receivedAt");
CREATE INDEX "n8n_command_receipts_workspaceId_correlationId_idx" ON "n8n_command_receipts"("workspaceId", "correlationId");
CREATE UNIQUE INDEX "n8n_action_proposals_workspaceId_id_key" ON "n8n_action_proposals"("workspaceId", "id");
CREATE UNIQUE INDEX "n8n_action_proposals_workspaceId_machineIdentityId_idempotencyKey_key" ON "n8n_action_proposals"("workspaceId", "machineIdentityId", "idempotencyKey");
CREATE INDEX "n8n_action_proposals_workspaceId_status_createdAt_idx" ON "n8n_action_proposals"("workspaceId", "status", "createdAt");
CREATE INDEX "n8n_action_proposals_workspaceId_targetType_targetId_status_idx" ON "n8n_action_proposals"("workspaceId", "targetType", "targetId", "status");
CREATE INDEX "n8n_action_proposals_workspaceId_correlationId_idx" ON "n8n_action_proposals"("workspaceId", "correlationId");

ALTER TABLE "n8n_machine_identities" ADD CONSTRAINT "n8n_machine_identities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_machine_identities" ADD CONSTRAINT "n8n_machine_identities_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_machine_identities" ADD CONSTRAINT "n8n_machine_identities_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_machine_identities" ADD CONSTRAINT "n8n_machine_identities_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_machine_identities" ADD CONSTRAINT "n8n_machine_identities_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_machine_permissions" ADD CONSTRAINT "n8n_machine_permissions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_machine_permissions" ADD CONSTRAINT "n8n_machine_permissions_workspaceId_machineIdentityId_fkey" FOREIGN KEY ("workspaceId", "machineIdentityId") REFERENCES "n8n_machine_identities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_recipes" ADD CONSTRAINT "n8n_recipes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_recipes" ADD CONSTRAINT "n8n_recipes_workspaceId_ownerMemberId_fkey" FOREIGN KEY ("workspaceId", "ownerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_recipes" ADD CONSTRAINT "n8n_recipes_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_recipes" ADD CONSTRAINT "n8n_recipes_workspaceId_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_recipe_versions" ADD CONSTRAINT "n8n_recipe_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_recipe_versions" ADD CONSTRAINT "n8n_recipe_versions_workspaceId_recipeId_fkey" FOREIGN KEY ("workspaceId", "recipeId") REFERENCES "n8n_recipes"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_recipe_versions" ADD CONSTRAINT "n8n_recipe_versions_workspaceId_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_command_receipts" ADD CONSTRAINT "n8n_command_receipts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_command_receipts" ADD CONSTRAINT "n8n_command_receipts_workspaceId_machineIdentityId_fkey" FOREIGN KEY ("workspaceId", "machineIdentityId") REFERENCES "n8n_machine_identities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_action_proposals" ADD CONSTRAINT "n8n_action_proposals_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_action_proposals" ADD CONSTRAINT "n8n_action_proposals_workspaceId_machineIdentityId_fkey" FOREIGN KEY ("workspaceId", "machineIdentityId") REFERENCES "n8n_machine_identities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_action_proposals" ADD CONSTRAINT "n8n_action_proposals_workspaceId_recipeId_fkey" FOREIGN KEY ("workspaceId", "recipeId") REFERENCES "n8n_recipes"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_action_proposals" ADD CONSTRAINT "n8n_action_proposals_workspaceId_recipeVersionId_fkey" FOREIGN KEY ("workspaceId", "recipeVersionId") REFERENCES "n8n_recipe_versions"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "n8n_action_proposals" ADD CONSTRAINT "n8n_action_proposals_workspaceId_reviewedByActorId_fkey" FOREIGN KEY ("workspaceId", "reviewedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_n8n_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CRM-60 n8n evidence is append-only'; END $$;
CREATE TRIGGER "n8n_recipe_versions_append_only" BEFORE UPDATE OR DELETE ON "n8n_recipe_versions" FOR EACH ROW EXECUTE FUNCTION prevent_n8n_evidence_mutation();
CREATE TRIGGER "n8n_command_receipts_append_only" BEFORE UPDATE OR DELETE ON "n8n_command_receipts" FOR EACH ROW EXECUTE FUNCTION prevent_n8n_evidence_mutation();
