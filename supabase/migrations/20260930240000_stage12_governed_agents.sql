SET search_path TO crm, public;

CREATE TABLE "governed_agents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "key" TEXT NOT NULL,
  "name" TEXT NOT NULL, "objective" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "draftRevision" INTEGER NOT NULL DEFAULT 1, "draftDefinition" JSONB NOT NULL, "activeVersionId" UUID,
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "governed_agents_pkey" PRIMARY KEY ("id"), CONSTRAINT "governed_agents_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','PAUSED'))
);
CREATE UNIQUE INDEX "governed_agents_workspaceId_id_key" ON "governed_agents"("workspaceId","id");
CREATE UNIQUE INDEX "governed_agents_workspaceId_key_key" ON "governed_agents"("workspaceId","key");
CREATE INDEX "governed_agents_workspaceId_status_updatedAt_idx" ON "governed_agents"("workspaceId","status","updatedAt");

CREATE TABLE "governed_agent_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "agentId" UUID NOT NULL, "version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL, "definitionHash" CHAR(64) NOT NULL, "knowledgeBaseVersion" INTEGER NOT NULL,
  "evaluation" JSONB NOT NULL, "rollbackOfVersionId" UUID, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "governed_agent_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "governed_agent_versions_workspaceId_id_key" ON "governed_agent_versions"("workspaceId","id");
CREATE UNIQUE INDEX "governed_agent_versions_workspaceId_agent_version_key" ON "governed_agent_versions"("workspaceId","agentId","version");
CREATE INDEX "governed_agent_versions_workspaceId_agent_createdAt_idx" ON "governed_agent_versions"("workspaceId","agentId","createdAt");

CREATE TABLE "agent_knowledge_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "agentId" UUID NOT NULL, "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL, "content" TEXT NOT NULL, "contentHash" CHAR(64) NOT NULL, "sourceReference" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT FALSE, "createdByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_knowledge_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_knowledge_documents_workspaceId_id_key" ON "agent_knowledge_documents"("workspaceId","id");
CREATE UNIQUE INDEX "agent_knowledge_documents_workspaceId_agent_version_hash_key" ON "agent_knowledge_documents"("workspaceId","agentId","version","contentHash");
CREATE INDEX "agent_knowledge_documents_workspaceId_agent_version_idx" ON "agent_knowledge_documents"("workspaceId","agentId","version");

CREATE TABLE "agent_conversation_leases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "conversationId" UUID NOT NULL, "agentId" UUID NOT NULL,
  "agentVersionId" UUID NOT NULL, "status" TEXT NOT NULL, "leaseToken" TEXT NOT NULL, "pausedReason" TEXT,
  "humanOwnerMemberId" UUID, "lastTriggerKey" TEXT NOT NULL, "acquiredAt" TIMESTAMPTZ(3) NOT NULL,
  "pausedAt" TIMESTAMPTZ(3), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_conversation_leases_pkey" PRIMARY KEY ("id"), CONSTRAINT "agent_conversation_leases_status_check" CHECK ("status" IN ('ACTIVE','HUMAN_PAUSED','HANDOFF','RELEASED'))
);
CREATE UNIQUE INDEX "agent_conversation_leases_workspaceId_id_key" ON "agent_conversation_leases"("workspaceId","id");
CREATE UNIQUE INDEX "agent_conversation_leases_workspaceId_conversationId_key" ON "agent_conversation_leases"("workspaceId","conversationId");
CREATE UNIQUE INDEX "agent_conversation_leases_workspaceId_lastTriggerKey_key" ON "agent_conversation_leases"("workspaceId","lastTriggerKey");
CREATE INDEX "agent_conversation_leases_workspaceId_agent_status_idx" ON "agent_conversation_leases"("workspaceId","agentId","status","updatedAt");

CREATE TABLE "agent_conversation_turns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "workspaceId" UUID NOT NULL, "leaseId" UUID NOT NULL, "conversationId" UUID NOT NULL,
  "agentVersionId" UUID NOT NULL, "idempotencyKey" TEXT NOT NULL, "status" TEXT NOT NULL, "userMessageFingerprint" CHAR(64) NOT NULL,
  "response" TEXT, "summary" TEXT, "sources" JSONB NOT NULL, "proposedFields" JSONB NOT NULL, "confidenceBps" INTEGER NOT NULL,
  "sensitiveAction" TEXT, "approvalStatus" TEXT, "approvalReason" TEXT, "approvedByActorId" UUID, "corrected" BOOLEAN NOT NULL DEFAULT FALSE,
  "costCents" INTEGER NOT NULL DEFAULT 0, "externalEgress" BOOLEAN NOT NULL DEFAULT FALSE, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3), CONSTRAINT "agent_conversation_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_conversation_turns_status_check" CHECK ("status" IN ('RESPONDED','HANDOFF','PENDING_APPROVAL')),
  CONSTRAINT "agent_conversation_turns_approval_check" CHECK ("approvalStatus" IS NULL OR "approvalStatus" IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT "agent_conversation_turns_cost_check" CHECK ("costCents" >= 0),
  CONSTRAINT "agent_conversation_turns_egress_check" CHECK ("externalEgress" = FALSE), CONSTRAINT "agent_conversation_turns_confidence_check" CHECK ("confidenceBps" BETWEEN 0 AND 10000)
);
CREATE UNIQUE INDEX "agent_conversation_turns_workspaceId_id_key" ON "agent_conversation_turns"("workspaceId","id");
CREATE UNIQUE INDEX "agent_conversation_turns_workspaceId_idempotencyKey_key" ON "agent_conversation_turns"("workspaceId","idempotencyKey");
CREATE INDEX "agent_conversation_turns_workspaceId_conversation_createdAt_idx" ON "agent_conversation_turns"("workspaceId","conversationId","createdAt");
CREATE INDEX "agent_conversation_turns_workspaceId_status_approval_idx" ON "agent_conversation_turns"("workspaceId","status","approvalStatus","createdAt");

ALTER TABLE "governed_agents" ADD CONSTRAINT "governed_agents_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT, ADD CONSTRAINT "governed_agents_created_actor_fkey" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "governed_agents_updated_actor_fkey" FOREIGN KEY ("workspaceId","updatedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "governed_agent_versions" ADD CONSTRAINT "governed_agent_versions_agent_fkey" FOREIGN KEY ("workspaceId","agentId") REFERENCES "governed_agents"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "governed_agent_versions_rollback_fkey" FOREIGN KEY ("workspaceId","rollbackOfVersionId") REFERENCES "governed_agent_versions"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "governed_agent_versions_created_actor_fkey" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "governed_agents" ADD CONSTRAINT "governed_agents_active_version_fkey" FOREIGN KEY ("workspaceId","activeVersionId") REFERENCES "governed_agent_versions"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "agent_knowledge_documents" ADD CONSTRAINT "agent_knowledge_documents_agent_fkey" FOREIGN KEY ("workspaceId","agentId") REFERENCES "governed_agents"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "agent_knowledge_documents_created_actor_fkey" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "agent_conversation_leases" ADD CONSTRAINT "agent_conversation_leases_conversation_fkey" FOREIGN KEY ("workspaceId","conversationId") REFERENCES "conversations"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "agent_conversation_leases_agent_fkey" FOREIGN KEY ("workspaceId","agentId") REFERENCES "governed_agents"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "agent_conversation_leases_version_fkey" FOREIGN KEY ("workspaceId","agentVersionId") REFERENCES "governed_agent_versions"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "agent_conversation_leases_human_owner_fkey" FOREIGN KEY ("workspaceId","humanOwnerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "agent_conversation_turns" ADD CONSTRAINT "agent_conversation_turns_lease_fkey" FOREIGN KEY ("workspaceId","leaseId") REFERENCES "agent_conversation_leases"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "agent_conversation_turns_conversation_fkey" FOREIGN KEY ("workspaceId","conversationId") REFERENCES "conversations"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "agent_conversation_turns_version_fkey" FOREIGN KEY ("workspaceId","agentVersionId") REFERENCES "governed_agent_versions"("workspaceId","id") ON DELETE RESTRICT, ADD CONSTRAINT "agent_conversation_turns_approved_actor_fkey" FOREIGN KEY ("workspaceId","approvedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION prevent_governed_agent_artifact_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'governed agent version artifacts are immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER governed_agent_versions_immutable BEFORE UPDATE OR DELETE ON "governed_agent_versions" FOR EACH ROW EXECUTE FUNCTION prevent_governed_agent_artifact_mutation();
CREATE TRIGGER agent_knowledge_documents_immutable BEFORE UPDATE OR DELETE ON "agent_knowledge_documents" FOR EACH ROW EXECUTE FUNCTION prevent_governed_agent_artifact_mutation();
REVOKE ALL ON TABLE "governed_agents", "governed_agent_versions", "agent_knowledge_documents", "agent_conversation_leases", "agent_conversation_turns" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE "governed_agents", "agent_conversation_leases", "agent_conversation_turns" TO service_role;
GRANT SELECT, INSERT ON TABLE "governed_agent_versions", "agent_knowledge_documents" TO service_role;
