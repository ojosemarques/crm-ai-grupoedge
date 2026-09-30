CREATE TABLE "strategy_funnels" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "definition" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "archivedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "strategy_funnels_status_ck" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT "strategy_funnels_name_ck" CHECK (length(trim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "strategy_funnels_revision_ck" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "strategy_funnels_workspace_id_key" ON "strategy_funnels"("workspaceId", "id");
CREATE UNIQUE INDEX "strategy_funnels_workspace_idempotency_key" ON "strategy_funnels"("workspaceId", "idempotencyKey");
CREATE INDEX "strategy_funnels_workspace_archived_updated_idx" ON "strategy_funnels"("workspaceId", "archivedAt", "updatedAt");

ALTER TABLE "strategy_funnels" ADD CONSTRAINT "strategy_funnels_workspace_fk"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "strategy_funnels" ADD CONSTRAINT "strategy_funnels_created_actor_fk"
  FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "strategy_funnels" ADD CONSTRAINT "strategy_funnels_updated_actor_fk"
  FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

ALTER TABLE "strategy_funnels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "strategy_funnels_private_runtime" ON "strategy_funnels"
  FOR ALL
  USING (
    current_user IN ('crm_politizai_runtime', 'service_role')
    AND EXISTS (SELECT 1 FROM "workspaces" w WHERE w."id" = "strategy_funnels"."workspaceId" AND w."status" = 'ACTIVE' AND w."deletedAt" IS NULL)
  )
  WITH CHECK (
    current_user IN ('crm_politizai_runtime', 'service_role')
    AND EXISTS (SELECT 1 FROM "workspaces" w WHERE w."id" = "strategy_funnels"."workspaceId" AND w."status" = 'ACTIVE' AND w."deletedAt" IS NULL)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON "strategy_funnels" TO crm_politizai_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON "strategy_funnels" TO service_role;
  END IF;
END $$;
