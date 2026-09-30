SET search_path TO crm, public;

CREATE TABLE "ai_assistant_proposals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "request" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "diff" JSONB NOT NULL,
  "impact" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "requestFingerprint" CHAR(64) NOT NULL,
  "publishedTargetType" TEXT,
  "publishedTargetId" UUID,
  "publishedTargetVersionId" UUID,
  "publishedVersionId" UUID,
  "cancellationReason" TEXT,
  "approvedReason" TEXT,
  "requestedByActorId" UUID NOT NULL,
  "approvedByActorId" UUID,
  "cancelledByActorId" UUID,
  "undoneByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "undoneAt" TIMESTAMPTZ(3),
  CONSTRAINT "ai_assistant_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_assistant_proposals_type_check" CHECK ("type" IN ('AGENT','PIPELINE_MODEL','AUTOMATION','CHART')),
  CONSTRAINT "ai_assistant_proposals_status_check" CHECK ("status" IN ('DRAFT','PUBLISHING','PUBLISH_FAILED','PUBLISHED','CANCELLED','UNDOING','UNDO_FAILED','UNDONE')),
  CONSTRAINT "ai_assistant_proposals_published_state_check" CHECK ("status" NOT IN ('PUBLISHED','UNDOING','UNDO_FAILED','UNDONE') OR ("publishedTargetType" IS NOT NULL AND "publishedTargetId" IS NOT NULL AND "publishedTargetVersionId" IS NOT NULL AND "publishedVersionId" IS NOT NULL)),
  CONSTRAINT "ai_assistant_proposals_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "ai_assistant_proposals_workspaceId_id_key" ON "ai_assistant_proposals"("workspaceId","id");
CREATE INDEX "ai_assistant_proposals_workspaceId_status_updatedAt_idx" ON "ai_assistant_proposals"("workspaceId","status","updatedAt");
CREATE INDEX "ai_assistant_proposals_workspaceId_requestedBy_createdAt_idx" ON "ai_assistant_proposals"("workspaceId","requestedByActorId","createdAt");
CREATE UNIQUE INDEX "ai_assistant_proposals_draft_retry_key" ON "ai_assistant_proposals"("workspaceId","requestedByActorId","requestFingerprint") WHERE "status" = 'DRAFT';

CREATE TABLE "ai_assistant_configuration_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "proposalId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "configurationType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshotHash" CHAR(64) NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" UUID,
  "targetVersionId" UUID,
  "rollbackOfVersionId" UUID,
  "publishedByActorId" UUID NOT NULL,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_assistant_configuration_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_assistant_configuration_versions_type_check" CHECK ("configurationType" IN ('AGENT','PIPELINE_MODEL','AUTOMATION','CHART')),
  CONSTRAINT "ai_assistant_configuration_versions_status_check" CHECK ("status" IN ('PUBLISHED','UNDONE')),
  CONSTRAINT "ai_assistant_configuration_versions_number_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "ai_assistant_configuration_versions_workspaceId_id_key" ON "ai_assistant_configuration_versions"("workspaceId","id");
CREATE UNIQUE INDEX "ai_assistant_configuration_versions_workspaceId_proposal_version_key" ON "ai_assistant_configuration_versions"("workspaceId","proposalId","version");
CREATE INDEX "ai_assistant_configuration_versions_workspaceId_type_publishedAt_idx" ON "ai_assistant_configuration_versions"("workspaceId","configurationType","publishedAt");

ALTER TABLE "ai_assistant_proposals"
  ADD CONSTRAINT "ai_assistant_proposals_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ai_assistant_proposals_requested_actor_fkey" FOREIGN KEY ("workspaceId","requestedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ai_assistant_proposals_approved_actor_fkey" FOREIGN KEY ("workspaceId","approvedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ai_assistant_proposals_cancelled_actor_fkey" FOREIGN KEY ("workspaceId","cancelledByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ai_assistant_proposals_undone_actor_fkey" FOREIGN KEY ("workspaceId","undoneByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "ai_assistant_configuration_versions"
  ADD CONSTRAINT "ai_assistant_configuration_versions_proposal_fkey" FOREIGN KEY ("workspaceId","proposalId") REFERENCES "ai_assistant_proposals"("workspaceId","id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ai_assistant_configuration_versions_rollback_fkey" FOREIGN KEY ("workspaceId","rollbackOfVersionId") REFERENCES "ai_assistant_configuration_versions"("workspaceId","id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ai_assistant_configuration_versions_published_actor_fkey" FOREIGN KEY ("workspaceId","publishedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "ai_assistant_proposals"
  ADD CONSTRAINT "ai_assistant_proposals_published_version_fkey" FOREIGN KEY ("workspaceId","publishedVersionId") REFERENCES "ai_assistant_configuration_versions"("workspaceId","id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION prevent_ai_assistant_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AI assistant configuration versions are immutable';
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, crm, public;
CREATE TRIGGER ai_assistant_configuration_versions_immutable
  BEFORE UPDATE OR DELETE ON "ai_assistant_configuration_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_ai_assistant_version_mutation();

REVOKE ALL ON TABLE "ai_assistant_proposals", "ai_assistant_configuration_versions" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE "ai_assistant_proposals" TO service_role;
GRANT SELECT, INSERT ON TABLE "ai_assistant_configuration_versions" TO service_role;
