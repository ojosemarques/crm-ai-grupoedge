SET search_path TO crm, public;

CREATE TABLE daily_goal_profiles (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "callsTarget" INTEGER NOT NULL DEFAULT 0,
  "messagesTarget" INTEGER NOT NULL DEFAULT 0,
  "effectiveContactsTarget" INTEGER NOT NULL DEFAULT 0,
  "qualificationsTarget" INTEGER NOT NULL DEFAULT 0,
  "meetingsScheduledTarget" INTEGER NOT NULL DEFAULT 0,
  "proposalsTarget" INTEGER NOT NULL DEFAULT 0,
  "salesValueTargetCents" BIGINT NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT daily_goal_profiles_pkey PRIMARY KEY ("id"),
  CONSTRAINT daily_goal_profiles_values_check CHECK (
    "callsTarget" BETWEEN 0 AND 100000
    AND "messagesTarget" BETWEEN 0 AND 100000
    AND "effectiveContactsTarget" BETWEEN 0 AND 100000
    AND "qualificationsTarget" BETWEEN 0 AND 100000
    AND "meetingsScheduledTarget" BETWEEN 0 AND 100000
    AND "proposalsTarget" BETWEEN 0 AND 100000
    AND "salesValueTargetCents" >= 0
    AND "revision" > 0
  ),
  CONSTRAINT daily_goal_profiles_workspace_fkey FOREIGN KEY ("workspaceId") REFERENCES workspaces("id") ON DELETE RESTRICT,
  CONSTRAINT daily_goal_profiles_member_fkey FOREIGN KEY ("workspaceId", "memberId") REFERENCES workspace_members("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT daily_goal_profiles_created_actor_fkey FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES actors("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT daily_goal_profiles_updated_actor_fkey FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES actors("workspaceId", "id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX daily_goal_profiles_workspaceId_id_key ON daily_goal_profiles("workspaceId", "id");
CREATE UNIQUE INDEX daily_goal_profiles_workspaceId_memberId_key ON daily_goal_profiles("workspaceId", "memberId");
CREATE INDEX daily_goal_profiles_workspaceId_updatedAt_idx ON daily_goal_profiles("workspaceId", "updatedAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE daily_goal_profiles TO crm_politizai_runtime;
