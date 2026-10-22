-- Metas coletivas: 12 agendadas e 6 realizadas/dia; o painel aplica × 5 na semana.
-- Executar no schema crm. A auditoria preserva os valores e revisões anteriores.
DO $setup$
DECLARE
  workspace_id uuid;
  actor_id uuid;
  profile record;
BEGIN
  IF current_schema() <> 'crm' AND current_schema() !~ '^politizai_test_' THEN
    RAISE EXCEPTION 'Configure o schema crm ou um schema temporário de testes.';
  END IF;
  SELECT id INTO STRICT workspace_id FROM workspaces
    WHERE slug = 'politizai' AND status = 'ACTIVE' AND "deletedAt" IS NULL;
  IF current_schema() = 'crm' AND workspace_id <> 'f99613d9-f4a1-449e-a19f-ed9ec3d46105'::uuid THEN
    RAISE EXCEPTION 'Workspace de produção diferente do autorizado.';
  END IF;
  SELECT id INTO STRICT actor_id FROM actors
    WHERE "workspaceId" = workspace_id AND type = 'SYSTEM' AND key = 'system';
  PERFORM pg_advisory_xact_lock(hashtextextended('politizai-meeting-goals:' || workspace_id::text, 0));
  PERFORM p.id FROM daily_goal_profiles p
    JOIN workspace_members m ON m.id = p."memberId" AND m."workspaceId" = p."workspaceId"
    JOIN users u ON u.id = m."userId"
    WHERE p."workspaceId" = workspace_id AND m.status = 'ACTIVE' AND m."deletedAt" IS NULL
      AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL
      AND u."normalizedEmail" IN ('carloshenrique@politizai.com', 'ederafael@politizai.com', 'jhoncunha@politizai.com')
    FOR UPDATE OF p;
  IF (SELECT count(*) FROM daily_goal_profiles p
    JOIN workspace_members m ON m.id = p."memberId" AND m."workspaceId" = p."workspaceId"
    JOIN users u ON u.id = m."userId"
    WHERE p."workspaceId" = workspace_id AND m.status = 'ACTIVE' AND m."deletedAt" IS NULL
      AND u.status = 'ACTIVE' AND u."deletedAt" IS NULL
      AND u."normalizedEmail" IN ('carloshenrique@politizai.com', 'ederafael@politizai.com', 'jhoncunha@politizai.com')
      AND p."meetingsScheduledTarget" = 4
      AND CASE WHEN u."normalizedEmail" = 'carloshenrique@politizai.com'
        THEN p."meetingsCompletedTarget" = 0 ELSE p."meetingsCompletedTarget" IN (2, 3) END) <> 3 THEN
    RAISE EXCEPTION 'Os perfis de metas mudaram; revisar antes de aplicar.';
  END IF;
  FOR profile IN
    SELECT p.* FROM daily_goal_profiles p
    JOIN workspace_members m ON m.id = p."memberId" AND m."workspaceId" = p."workspaceId"
    JOIN users u ON u.id = m."userId"
    WHERE p."workspaceId" = workspace_id
      AND u."normalizedEmail" IN ('ederafael@politizai.com', 'jhoncunha@politizai.com')
      AND p."meetingsCompletedTarget" = 2
  LOOP
    UPDATE daily_goal_profiles SET "meetingsCompletedTarget" = 3,
      revision = revision + 1, "updatedByActorId" = actor_id, "updatedAt" = now()
      WHERE id = profile.id AND "workspaceId" = workspace_id;
    INSERT INTO audit_logs (id, "workspaceId", "actorId", action, "entityType", "entityId", changes, metadata, "occurredAt")
    VALUES (gen_random_uuid(), workspace_id, actor_id, 'goals.daily.updated', 'DailyGoalProfile', profile.id,
      jsonb_build_object('memberId', profile."memberId",
        'before', jsonb_build_object('meetingsCompletedTarget', profile."meetingsCompletedTarget", 'revision', profile.revision),
        'after', jsonb_build_object('meetingsCompletedTarget', 3, 'revision', profile.revision + 1)),
      jsonb_build_object('source', 'configure-politizai-meeting-goals', 'configuredByManager', true), now());
  END LOOP;
END
$setup$;
