BEGIN;

ALTER TABLE "prospecting_research_batches"
  ADD COLUMN "sourcePopulationImportedAt" TIMESTAMPTZ(3),
  ADD COLUMN "sourceElectionEdition" TEXT,
  ADD COLUMN "sourceElectionHash" TEXT,
  ADD COLUMN "sourceElectionImportedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "prospecting_research_batches_election_hash_check"
    CHECK ("sourceElectionHash" IS NULL OR "sourceElectionHash" ~ '^[a-f0-9]{64}$');

CREATE TABLE "prospecting_reconciliation_states" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "findings" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "findingsHash" TEXT NOT NULL,
  "lastRunAt" TIMESTAMPTZ(3) NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "prospecting_reconciliation_states_status_check"
    CHECK ("status" IN ('HEALTHY', 'ATTENTION', 'CRITICAL')),
  CONSTRAINT "prospecting_reconciliation_states_hash_check"
    CHECK ("findingsHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "prospecting_reconciliation_states_workspace_fk"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_reconciliation_states_created_actor_fk"
    FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "prospecting_reconciliation_states_updated_actor_fk"
    FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "prospecting_reconciliation_states_workspace_id_key"
  ON "prospecting_reconciliation_states"("workspaceId", "id");
CREATE UNIQUE INDEX "prospecting_reconciliation_states_workspace_key"
  ON "prospecting_reconciliation_states"("workspaceId");
CREATE INDEX "prospecting_reconciliation_states_status_run_idx"
  ON "prospecting_reconciliation_states"("status", "lastRunAt");
CREATE INDEX "prospecting_reconciliation_states_created_actor_idx"
  ON "prospecting_reconciliation_states"("workspaceId", "createdByActorId");
CREATE INDEX "prospecting_reconciliation_states_updated_actor_idx"
  ON "prospecting_reconciliation_states"("workspaceId", "updatedByActorId");
CREATE INDEX "open_dot_request_receipts_scope_idx"
  ON "open_dot_request_receipts"("workspaceId", "scope", "receivedAt");

ALTER TABLE "prospecting_reconciliation_states" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "prospecting_reconciliation_states" FROM PUBLIC;

DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', 'prospecting_reconciliation_states', role_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
