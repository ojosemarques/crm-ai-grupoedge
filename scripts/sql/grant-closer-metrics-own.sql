-- Apply with psql -v workspace_id=<verified-workspace-uuid> after deployment.
-- Inserts only a missing OWN grant. Existing grants are preserved.
WITH target AS (
  SELECT r."workspaceId", r.id AS "roleId", p.id AS "permissionId", a.id AS "actorId"
  FROM roles r CROSS JOIN permissions p
  JOIN actors a ON a."workspaceId" = r."workspaceId" AND a.key = 'system' AND a.type = 'SYSTEM'
  WHERE r."workspaceId" = :'workspace_id'::uuid AND r.key = 'closer' AND r."deletedAt" IS NULL AND p.key = 'metrics.read'
), inserted AS (
  INSERT INTO role_permissions (id, "workspaceId", "roleId", "permissionId", scope, "createdByActorId")
  SELECT gen_random_uuid(), "workspaceId", "roleId", "permissionId", 'OWN', "actorId" FROM target
  ON CONFLICT ("workspaceId", "roleId", "permissionId") DO NOTHING
  RETURNING id, "workspaceId", "roleId", "createdByActorId"
), audited AS (
  INSERT INTO audit_logs (id, "workspaceId", "actorId", action, "entityType", "entityId", reason, changes)
  SELECT gen_random_uuid(), "workspaceId", "createdByActorId", 'role.metrics_own.granted', 'RolePermission', id,
    'Indicadores de Anúncios e Prospecção: permitir ao closer consultar somente sua contribuição autorizada.',
    jsonb_build_object('roleId', "roleId", 'permission', 'metrics.read', 'scope', 'OWN', 'source', 'indicadores-anuncios-prospeccao')
  FROM inserted RETURNING id
)
SELECT (SELECT count(*) FROM inserted) AS grants_created, (SELECT count(*) FROM audited) AS audits_created;
