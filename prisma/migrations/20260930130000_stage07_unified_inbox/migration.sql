CREATE TYPE "ConversationServiceType" AS ENUM ('SALES', 'SPECIALIST', 'CUSTOMER_SUCCESS');
ALTER TYPE "OmnichannelMessageType" ADD VALUE 'NOTE';

ALTER TABLE "queues"
  ADD COLUMN "conversationServiceType" "ConversationServiceType" NOT NULL DEFAULT 'SALES',
  ADD COLUMN "conversationSlaSeconds" INTEGER NOT NULL DEFAULT 180,
  ADD CONSTRAINT "queues_conversation_sla_seconds_check" CHECK ("conversationSlaSeconds" > 0);

ALTER TABLE "conversations"
  ADD COLUMN "serviceType" "ConversationServiceType" NOT NULL DEFAULT 'SALES',
  ADD COLUMN "slaTargetSeconds" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN "slaDueAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "conversations_sla_target_seconds_check" CHECK ("slaTargetSeconds" > 0);

UPDATE "conversations" c
SET "serviceType" = q."conversationServiceType",
    "slaTargetSeconds" = q."conversationSlaSeconds",
    "slaDueAt" = CASE WHEN c."status" = 'PENDING_INTERNAL' AND c."waitingSince" IS NOT NULL
      THEN c."waitingSince" + make_interval(secs => q."conversationSlaSeconds") ELSE NULL END
FROM "queues" q
WHERE q."id" = c."queueId" AND q."workspaceId" = c."workspaceId";

UPDATE "conversations"
SET "slaDueAt" = "waitingSince" + make_interval(secs => "slaTargetSeconds")
WHERE "status" = 'PENDING_INTERNAL' AND "waitingSince" IS NOT NULL AND "slaDueAt" IS NULL;

CREATE INDEX "conversations_workspaceId_slaDueAt_status_idx" ON "conversations"("workspaceId", "slaDueAt", "status");
