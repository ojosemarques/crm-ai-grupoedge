-- Etapa 17: permissões explícitas para ações em massa e exportações.

INSERT INTO "permissions" ("id", "key", "description", "createdAt")
VALUES
  (md5('permission:bulk_actions.execute')::uuid, 'bulk_actions.execute', 'Executar ações em massa dentro do escopo autorizado', CURRENT_TIMESTAMP),
  (md5('permission:exports.execute')::uuid, 'exports.execute', 'Exportar dados dentro do escopo autorizado', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope",
  "createdByActorId", "createdAt"
)
SELECT
  md5(role."workspaceId"::text || ':' || role.id::text || ':' || permission.key)::uuid,
  role."workspaceId",
  role.id,
  permission.id,
  CASE
    WHEN role.key = 'administrator' THEN 'WORKSPACE'::"PermissionScope"
    ELSE 'TEAM'::"PermissionScope"
  END,
  role."createdByActorId",
  CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission
  ON permission.key IN ('bulk_actions.execute', 'exports.execute')
WHERE role.key IN ('administrator', 'commercial_manager')
  AND role."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "roleId", "permissionId") DO UPDATE SET
  "scope" = EXCLUDED."scope";
