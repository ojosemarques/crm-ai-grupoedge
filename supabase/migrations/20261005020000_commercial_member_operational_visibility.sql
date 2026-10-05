SET search_path TO crm, public;

-- Recover commercial users created without an operational team and grant sellers
-- the own-scope lead/task access required by Meu Dia and lead cards.
BEGIN;

WITH commercial_members AS (
  SELECT
    wm."workspaceId",
    wm."id" AS "workspaceMemberId",
    wm."updatedByActorId",
    CASE WHEN r."key" = 'closer' THEN 'CLOSER'::"TeamFunction" ELSE 'SDR'::"TeamFunction" END AS "function"
  FROM "workspace_members" wm
  JOIN "roles" r
    ON r."workspaceId" = wm."workspaceId"
   AND r."id" = wm."roleId"
   AND r."deletedAt" IS NULL
  WHERE wm."status" = 'ACTIVE'
    AND wm."deletedAt" IS NULL
    AND r."key" IN ('sdr', 'closer')
    AND NOT EXISTS (
      SELECT 1
      FROM "team_members" existing
      JOIN "teams" existing_team
        ON existing_team."workspaceId" = existing."workspaceId"
       AND existing_team."id" = existing."teamId"
       AND existing_team."deletedAt" IS NULL
      WHERE existing."workspaceId" = wm."workspaceId"
        AND existing."workspaceMemberId" = wm."id"
        AND existing."deletedAt" IS NULL
    )
),
preferred_teams AS (
  SELECT
    member.*,
    preferred."id" AS "teamId"
  FROM commercial_members member
  JOIN LATERAL (
    SELECT team."id"
    FROM "teams" team
    WHERE team."workspaceId" = member."workspaceId"
      AND team."deletedAt" IS NULL
    ORDER BY
      CASE
        WHEN member."function" = 'CLOSER'::"TeamFunction"
          AND (
            (lower(team."name") LIKE '%venda%' AND lower(team."name") NOT LIKE '%pre-venda%' AND lower(team."name") NOT LIKE '%pré-venda%')
            OR lower(team."name") LIKE '%comercial%'
            OR lower(team."name") LIKE '%closer%'
          ) THEN 0
        WHEN member."function" = 'SDR'::"TeamFunction"
          AND (
            lower(team."name") LIKE '%pre-venda%'
            OR lower(team."name") LIKE '%pré-venda%'
            OR lower(team."name") LIKE '%sdr%'
            OR lower(team."name") LIKE '%prospec%'
          ) THEN 0
        ELSE 1
      END,
      team."name",
      team."id"
    LIMIT 1
  ) preferred ON TRUE
)
INSERT INTO "team_members" (
  "id",
  "workspaceId",
  "teamId",
  "workspaceMemberId",
  "function",
  "createdByActorId",
  "updatedByActorId",
  "createdAt",
  "updatedAt",
  "deletedAt"
)
SELECT
  gen_random_uuid(),
  member."workspaceId",
  member."teamId",
  member."workspaceMemberId",
  member."function",
  member."updatedByActorId",
  member."updatedByActorId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL
FROM preferred_teams member
ON CONFLICT ("workspaceId", "teamId", "workspaceMemberId")
DO UPDATE SET
  "function" = EXCLUDED."function",
  "updatedByActorId" = EXCLUDED."updatedByActorId",
  "updatedAt" = CURRENT_TIMESTAMP,
  "deletedAt" = NULL;

INSERT INTO "role_permissions" (
  "id",
  "workspaceId",
  "roleId",
  "permissionId",
  "scope",
  "createdByActorId",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  role."workspaceId",
  role."id",
  permission."id",
  'OWN'::"PermissionScope",
  role."updatedByActorId",
  CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission
  ON permission."key" IN ('leads.read', 'leads.write', 'tasks.read', 'tasks.write')
WHERE role."key" = 'closer'
  AND role."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "roleId", "permissionId") DO NOTHING;

COMMIT;
