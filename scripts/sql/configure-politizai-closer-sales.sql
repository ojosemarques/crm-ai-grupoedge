-- Libera somente o fechamento integrado próprio; não concede acesso financeiro.
DO $setup$
DECLARE
  workspace_id uuid;
  actor_id uuid;
  permission_id uuid;
  inserted_count integer;
BEGIN
  IF current_schema() <> 'crm' AND current_schema() !~ '^politizai_test_' THEN
    RAISE EXCEPTION 'Configure o schema crm ou um schema temporário de testes.';
  END IF;
  SELECT id INTO STRICT workspace_id FROM workspaces
    WHERE slug = 'politizai' AND status = 'ACTIVE' AND "deletedAt" IS NULL;
  SELECT id INTO STRICT actor_id FROM actors
    WHERE "workspaceId" = workspace_id AND type = 'SYSTEM' AND key = 'system';
  PERFORM pg_advisory_xact_lock(hashtextextended('politizai-sales-permissions:' || workspace_id::text, 0));
  INSERT INTO permissions (id, key, description)
    VALUES (gen_random_uuid(), 'sales.complete', 'Concluir a venda integrada no escopo autorizado, sem conceder acesso financeiro geral')
    ON CONFLICT (key) DO NOTHING;
  SELECT id INTO STRICT permission_id FROM permissions WHERE key = 'sales.complete';
  INSERT INTO role_permissions (id, "workspaceId", "roleId", "permissionId", scope, "createdByActorId")
    SELECT gen_random_uuid(), workspace_id, id, permission_id,
      CASE WHEN key = 'closer' THEN 'OWN'::"PermissionScope" ELSE 'WORKSPACE'::"PermissionScope" END, actor_id
    FROM roles WHERE "workspaceId" = workspace_id AND key IN ('closer', 'administrator') AND "deletedAt" IS NULL
    ON CONFLICT ("workspaceId", "roleId", "permissionId") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp."roleId"
    WHERE rp."workspaceId" = workspace_id AND r.key = 'closer' AND rp."permissionId" = permission_id AND rp.scope = 'OWN') THEN
    RAISE EXCEPTION 'A liberação do Closer deve ter escopo OWN.';
  END IF;
  IF inserted_count > 0 THEN
    INSERT INTO audit_logs (id, "workspaceId", "actorId", action, "entityType", "entityId", changes)
      VALUES (gen_random_uuid(), workspace_id, actor_id, 'sales.closer.enabled', 'Workspace', workspace_id,
        jsonb_build_object('permission', 'sales.complete', 'closerScope', 'OWN', 'canRecordReceipt', false));
  END IF;
END
$setup$;
