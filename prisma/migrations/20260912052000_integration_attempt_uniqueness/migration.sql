-- Nullable columns do not participate in ordinary UNIQUE equality in PostgreSQL.
-- Partial indexes guarantee one append-only attempt number per concrete target.
CREATE UNIQUE INDEX "integration_attempts_inbox_number_key"
ON "integration_delivery_attempts" ("workspaceId", "inboxId", "attemptNumber")
WHERE "inboxId" IS NOT NULL;

CREATE UNIQUE INDEX "integration_attempts_outbox_number_key"
ON "integration_delivery_attempts" ("workspaceId", "outboxId", "attemptNumber")
WHERE "outboxId" IS NOT NULL;

CREATE UNIQUE INDEX "integration_attempts_sync_number_key"
ON "integration_delivery_attempts" ("workspaceId", "syncRunId", "attemptNumber")
WHERE "syncRunId" IS NOT NULL;
