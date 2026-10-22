SET search_path TO crm, public;

-- Dashboard Tempo Real: capability grants and revocable public bearer.
BEGIN;

CREATE TABLE "realtime_dashboard_shares" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "revokedByActorId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "rotatedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "realtime_dashboard_shares_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "realtime_dashboard_shares_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "realtime_dashboard_shares_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "realtime_dashboard_shares_workspaceId_key"
  ON "realtime_dashboard_shares"("workspaceId");
CREATE UNIQUE INDEX "realtime_dashboard_shares_tokenHash_key"
  ON "realtime_dashboard_shares"("tokenHash");
CREATE INDEX "realtime_dashboard_shares_workspaceId_revokedAt_idx"
  ON "realtime_dashboard_shares"("workspaceId", "revokedAt");

ALTER TABLE "realtime_dashboard_shares"
  ADD CONSTRAINT "realtime_dashboard_shares_workspace_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "realtime_dashboard_shares"
  ADD CONSTRAINT "realtime_dashboard_shares_created_actor_fkey"
  FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "realtime_dashboard_shares"
  ADD CONSTRAINT "realtime_dashboard_shares_updated_actor_fkey"
  FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "realtime_dashboard_shares"
  ADD CONSTRAINT "realtime_dashboard_shares_revoked_actor_fkey"
  FOREIGN KEY ("workspaceId", "revokedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "key", "description", "createdAt") VALUES
  (md5('permission:realtime.read')::uuid, 'realtime.read', 'Consultar o placar comercial em tempo real', CURRENT_TIMESTAMP),
  (md5('permission:realtime.share.manage')::uuid, 'realtime.share.manage', 'Gerenciar o link público do placar em tempo real', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope", "createdByActorId", "createdAt"
)
SELECT
  md5(role."workspaceId"::text || ':' || role."id"::text || ':' || permission."key")::uuid,
  role."workspaceId",
  role."id",
  permission."id",
  'WORKSPACE'::"PermissionScope",
  role."createdByActorId",
  CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."key" IN ('realtime.read', 'realtime.share.manage')
WHERE role."key" IN ('administrator', 'commercial_manager')
  AND role."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "roleId", "permissionId") DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "realtime_dashboard_shares" TO crm_politizai_runtime;

COMMIT;
