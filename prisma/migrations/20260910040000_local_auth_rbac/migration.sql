-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('WORKSPACE', 'TEAM', 'OWN');

-- AlterTable
ALTER TABLE "queues" ADD COLUMN     "teamId" UUID;

-- AlterTable
ALTER TABLE "role_permissions" ADD COLUMN     "scope" "PermissionScope" NOT NULL DEFAULT 'WORKSPACE';

-- CreateTable
CREATE TABLE "local_credentials" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL DEFAULT 1,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "local_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "workspaceMemberId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "ipAddress" INET,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_credentials_userId_key" ON "local_credentials"("userId");

-- CreateIndex
CREATE INDEX "local_credentials_lockedUntil_idx" ON "local_credentials"("lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_workspaceId_workspaceMemberId_revokedAt_expir_idx" ON "auth_sessions"("workspaceId", "workspaceMemberId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "auth_sessions_userId_revokedAt_expiresAt_idx" ON "auth_sessions"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "auth_sessions_expiresAt_revokedAt_idx" ON "auth_sessions"("expiresAt", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_workspaceId_id_key" ON "auth_sessions"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "queues_workspaceId_teamId_deletedAt_idx" ON "queues"("workspaceId", "teamId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_id_key" ON "workspace_members"("workspaceId", "userId", "id");

-- AddForeignKey
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_workspaceId_userId_workspaceMemberId_fkey" FOREIGN KEY ("workspaceId", "userId", "workspaceMemberId") REFERENCES "workspace_members"("workspaceId", "userId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queues" ADD CONSTRAINT "queues_workspaceId_teamId_fkey" FOREIGN KEY ("workspaceId", "teamId") REFERENCES "teams"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Credential and session invariants not expressible in Prisma's schema language.
ALTER TABLE "local_credentials"
  ADD CONSTRAINT "local_credentials_version_check"
  CHECK ("credentialVersion" > 0),
  ADD CONSTRAINT "local_credentials_failed_attempts_check"
  CHECK ("failedAttempts" >= 0),
  ADD CONSTRAINT "local_credentials_hash_format_check"
  CHECK ("passwordHash" ~ '^scrypt[$][0-9]+[$][0-9]+[$][0-9]+[$][A-Za-z0-9_-]+[$][A-Za-z0-9_-]+$');

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_token_hash_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "auth_sessions_credential_version_check"
  CHECK ("credentialVersion" > 0),
  ADD CONSTRAINT "auth_sessions_time_order_check"
  CHECK (
    "expiresAt" > "createdAt"
    AND "lastSeenAt" >= "createdAt"
    AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
  );

CREATE FUNCTION "enforce_auth_session_human_actor"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "actors"
    WHERE "workspaceId" = NEW."workspaceId"
      AND "id" = NEW."actorId"
      AND "type" = 'HUMAN'
      AND "userId" = NEW."userId"
  )
  THEN
    RAISE EXCEPTION 'auth session requires the matching human actor'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "auth_sessions_human_actor_trigger"
  AFTER INSERT OR UPDATE OF "workspaceId", "userId", "actorId" ON "auth_sessions"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION "enforce_auth_session_human_actor"();
