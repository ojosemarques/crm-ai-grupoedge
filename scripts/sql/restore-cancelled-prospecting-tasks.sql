-- Executar em uma transação, com search_path e os dois parâmetros app.task_repair_* explícitos.
-- Repetir até retornar zero; nunca reativa a cadência nem seus envios automáticos.
WITH eligible AS MATERIALIZED (
  SELECT t.id, t."workspaceId", t."leadId", s.id AS "stepId", a.id AS "actorId",
    jsonb_build_object(
      'task', jsonb_build_object('id', t.id, 'status', t.status, 'result', t.result,
        'updatedAt', t."updatedAt", 'updatedByActorId', t."updatedByActorId"),
      'step', jsonb_build_object('id', s.id, 'status', s.status, 'resultCode', s."resultCode",
        'resultReason', s."resultReason", 'cancelledAt', s."cancelledAt", 'updatedAt', s."updatedAt"),
      'lead', jsonb_build_object('id', l.id, 'nextActionTaskId', l."nextActionTaskId",
        'nextActionAt', l."nextActionAt", 'nextActionDescription', l."nextActionDescription",
        'updatedAt', l."updatedAt", 'updatedByActorId', l."updatedByActorId")
    ) AS previous
  FROM tasks t
  JOIN leads l ON l.id = t."leadId" AND l."workspaceId" = t."workspaceId"
  JOIN workspaces w ON w.id = t."workspaceId" AND w.status = 'ACTIVE' AND w."deletedAt" IS NULL
  JOIN actors a ON a."workspaceId" = w.id AND a.type = 'SYSTEM' AND a.key = 'system'
  JOIN prospecting_cadence_steps s ON s."taskId" = t.id AND s."workspaceId" = t."workspaceId" AND s."leadId" = l.id
  JOIN prospecting_cadence_instances c ON c.id = s."cadenceInstanceId" AND c."workspaceId" = t."workspaceId" AND c."leadId" = l.id
  WHERE t."workspaceId" = current_setting('app.task_repair_workspace_id')::uuid
    AND t.status = 'CANCELLED' AND t."deletedAt" IS NULL AND t."completedAt" IS NULL
    AND t.result IN ('CONTACT_CONNECTED', 'HUMAN_REPLY', 'MEETING_SCHEDULED', 'D30_NO_RESPONSE')
    AND t."sourceKey" = 'active-prospecting:' || c.id::text || ':' || s."stepKey"
    AND s.executor = 'SELLER' AND s.status = 'CANCELLED' AND s."completedAt" IS NULL
    AND s."resultReason" = t.result
    AND c.status IN ('CONVERSATION_STARTED', 'MEETING_SCHEDULED', 'CLOSED_NO_RESPONSE')
    AND c."stopReasonCode" IN ('CONTACT_CONNECTED', 'HUMAN_REPLY', 'MEETING_SCHEDULED', 'D30_NO_RESPONSE')
    AND l.status IN ('OPEN', 'QUALIFIED') AND l."deletedAt" IS NULL
    AND l."contactPreference" <> 'DO_NOT_CONTACT'
    AND NOT EXISTS (
      SELECT 1 FROM contact_points p WHERE p."workspaceId" = l."workspaceId"
        AND p."contactId" = l."contactId" AND p."doNotContact" AND p."deletedAt" IS NULL
    )
  ORDER BY l.id, t.id
  LIMIT 1000
  FOR UPDATE OF t, s, l, c SKIP LOCKED
), restored_tasks AS (
  UPDATE tasks t SET status = 'OPEN', result = NULL, "updatedAt" = now(), "updatedByActorId" = e."actorId"
  FROM eligible e WHERE t.id = e.id AND t."workspaceId" = e."workspaceId"
  RETURNING t.id, t."workspaceId", t."leadId"
), restored_steps AS (
  UPDATE prospecting_cadence_steps s SET status = 'OPEN', "cancelledAt" = NULL,
    "resultCode" = NULL, "resultReason" = NULL, "updatedAt" = now()
  FROM eligible e JOIN restored_tasks t ON t.id = e.id
  WHERE s.id = e."stepId" AND s."workspaceId" = e."workspaceId"
  RETURNING s.id
), next_tasks AS (
  SELECT DISTINCT ON (t."leadId") t."leadId", t.id, t."dueAt", t.title
  FROM tasks t
  WHERE t."workspaceId" = current_setting('app.task_repair_workspace_id')::uuid
    AND t."leadId" IN (SELECT "leadId" FROM restored_tasks) AND t."deletedAt" IS NULL
    AND (t.status IN ('OPEN', 'IN_PROGRESS') OR t.id IN (SELECT id FROM restored_tasks))
  ORDER BY t."leadId", t."dueAt", t."createdAt", t.id
), restored_leads AS (
  UPDATE leads l SET "nextActionTaskId" = n.id, "nextActionAt" = n."dueAt",
    "nextActionDescription" = n.title, "updatedAt" = now(),
    "updatedByActorId" = (SELECT e."actorId" FROM eligible e WHERE e."leadId" = l.id LIMIT 1)
  FROM next_tasks n WHERE l.id = n."leadId" AND l."workspaceId" = current_setting('app.task_repair_workspace_id')::uuid
  RETURNING l.id
), audit AS (
  INSERT INTO audit_logs (id, "workspaceId", "actorId", action, "entityType", "entityId",
    "occurredAt", "requestId", origin, reason, changes)
  SELECT gen_random_uuid(), e."workspaceId", e."actorId", 'prospecting.manual_task.restored', 'Task', e.id,
    now(), current_setting('app.task_repair_run_id'), 'SYSTEM',
    'Correção do cancelamento automático de tarefa manual após contato ou reunião.',
    jsonb_build_object('previous', e.previous, 'status', 'OPEN', 'externalEgress', false)
  FROM eligible e JOIN restored_tasks t ON t.id = e.id
  RETURNING id
)
SELECT (SELECT count(*)::int FROM restored_tasks) AS tasks,
  (SELECT count(*)::int FROM restored_steps) AS steps,
  (SELECT count(*)::int FROM restored_leads) AS leads,
  (SELECT count(*)::int FROM audit) AS audits;
