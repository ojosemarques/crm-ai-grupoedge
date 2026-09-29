-- CRM-27: permissão explícita para consultas gerenciais assistidas.

BEGIN;

INSERT INTO "permissions" ("id", "key", "description", "createdAt")
VALUES (
  gen_random_uuid(),
  'ai.manager.query',
  'Consultar o Copilot gerencial com métricas autorizadas',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope",
  "createdByActorId", "createdAt"
)
SELECT
  gen_random_uuid(),
  role."workspaceId",
  role."id",
  permission."id",
  CASE
    WHEN role."key" = 'administrator' THEN 'WORKSPACE'::"PermissionScope"
    ELSE 'TEAM'::"PermissionScope"
  END,
  role."createdByActorId",
  CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission."key" = 'ai.manager.query'
WHERE role."key" IN ('administrator', 'commercial_manager')
  AND role."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permissions" existing
    WHERE existing."workspaceId" = role."workspaceId"
      AND existing."roleId" = role."id"
      AND existing."permissionId" = permission."id"
  );

COMMIT;
