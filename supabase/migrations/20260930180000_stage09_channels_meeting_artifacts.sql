SET search_path TO crm, public;
CREATE TABLE "meeting_transcript_artifacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "meetingId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "transcriptText" TEXT,
  "summary" TEXT,
  "policyVersion" TEXT NOT NULL,
  "consentEvidence" TEXT NOT NULL,
  "consentRecordedAt" TIMESTAMPTZ(3) NOT NULL,
  "retentionUntil" TIMESTAMPTZ(3) NOT NULL,
  "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_transcript_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meeting_transcript_artifacts_content_check" CHECK ("transcriptText" IS NOT NULL OR "summary" IS NOT NULL),
  CONSTRAINT "meeting_transcript_artifacts_retention_check" CHECK ("retentionUntil" > "consentRecordedAt")
);

ALTER TABLE "meeting_transcript_artifacts"
  ADD CONSTRAINT "meeting_transcript_artifacts_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "meeting_transcript_artifacts_meeting_fkey" FOREIGN KEY ("workspaceId","meetingId") REFERENCES "meetings"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "meeting_transcript_artifacts_actor_fkey" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "meeting_transcript_artifacts_workspaceId_id_key" ON "meeting_transcript_artifacts"("workspaceId","id");
CREATE UNIQUE INDEX "meeting_transcript_artifacts_workspaceId_meetingId_version_key" ON "meeting_transcript_artifacts"("workspaceId","meetingId","version");
CREATE INDEX "meeting_transcript_artifacts_workspaceId_meetingId_createdAt_idx" ON "meeting_transcript_artifacts"("workspaceId","meetingId","createdAt");
CREATE INDEX "meeting_transcript_artifacts_workspaceId_retentionUntil_idx" ON "meeting_transcript_artifacts"("workspaceId","retentionUntil");

CREATE FUNCTION prevent_stage09_transcript_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stage09 meeting transcript artifacts are append-only';
END $$;

CREATE TRIGGER "meeting_transcript_artifacts_append_only"
BEFORE UPDATE OR DELETE ON "meeting_transcript_artifacts"
FOR EACH ROW EXECUTE FUNCTION prevent_stage09_transcript_mutation();

INSERT INTO "permissions" ("id","key","description","createdAt") VALUES
  (md5('permission:meetings.transcripts.read')::uuid, 'meetings.transcripts.read', 'Consultar transcrições e resumos de reunião com consentimento', CURRENT_TIMESTAMP),
  (md5('permission:meetings.transcripts.manage')::uuid, 'meetings.transcripts.manage', 'Registrar artefatos de transcrição com consentimento e retenção', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id","workspaceId","roleId","permissionId","scope","createdByActorId","createdAt")
SELECT md5(w.id::text || ':' || r.id::text || ':' || p.key)::uuid, w.id, r.id, p.id, 'WORKSPACE'::"PermissionScope", a.id, CURRENT_TIMESTAMP
FROM "workspaces" w
JOIN "roles" r ON r."workspaceId" = w.id AND r.key = 'administrator' AND r."deletedAt" IS NULL
JOIN "actors" a ON a."workspaceId" = w.id AND a.key = 'system'
JOIN "permissions" p ON p.key IN ('meetings.transcripts.read','meetings.transcripts.manage')
ON CONFLICT ("workspaceId","roleId","permissionId") DO NOTHING;


REVOKE ALL ON TABLE "meeting_transcript_artifacts" FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE "meeting_transcript_artifacts" TO service_role;
