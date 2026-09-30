SET search_path TO crm, public;

ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'OUTBOUND_CAMPAIGN';

CREATE TABLE "outbound_campaigns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "providerMode" TEXT NOT NULL DEFAULT 'LOCAL_SIMULATOR',
  "purposeKey" TEXT NOT NULL,
  "templateBody" TEXT NOT NULL,
  "segmentDefinition" JSONB NOT NULL,
  "postActions" JSONB NOT NULL,
  "windowStartMinute" INTEGER NOT NULL,
  "windowEndMinute" INTEGER NOT NULL,
  "timeZone" TEXT NOT NULL,
  "scheduledAt" TIMESTAMPTZ(3),
  "maxRecipients" INTEGER NOT NULL,
  "unitCostCents" INTEGER NOT NULL DEFAULT 0,
  "estimatedVolume" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostCents" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "snapshotHash" TEXT,
  "previewedAt" TIMESTAMPTZ(3),
  "approvedAt" TIMESTAMPTZ(3),
  "approvedByActorId" UUID,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelledByActorId" UUID,
  "cancellationReason" TEXT,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_campaigns_channel_check" CHECK ("channel" IN ('WHATSAPP','SMS','FLASH','VOICE')),
  CONSTRAINT "outbound_campaigns_provider_check" CHECK ("providerMode" IN ('LOCAL_SIMULATOR','EXTERNAL_AUTHORIZED')),
  CONSTRAINT "outbound_campaigns_status_check" CHECK ("status" IN ('DRAFT','PREVIEWED','APPROVED','RUNNING','COMPLETED','CANCELLED')),
  CONSTRAINT "outbound_campaigns_window_check" CHECK ("windowStartMinute" BETWEEN 0 AND 1439 AND "windowEndMinute" BETWEEN 1 AND 1440 AND "windowStartMinute" < "windowEndMinute"),
  CONSTRAINT "outbound_campaigns_limits_check" CHECK ("maxRecipients" BETWEEN 1 AND 10000 AND "unitCostCents" >= 0 AND "estimatedVolume" >= 0 AND "estimatedCostCents" >= 0)
);
CREATE UNIQUE INDEX "outbound_campaigns_workspaceId_id_key" ON "outbound_campaigns"("workspaceId","id");
CREATE INDEX "outbound_campaigns_workspaceId_status_scheduledAt_idx" ON "outbound_campaigns"("workspaceId","status","scheduledAt");

CREATE TABLE "outbound_campaign_recipients" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "leadId" UUID NOT NULL,
  "contactId" UUID,
  "contactPointId" UUID,
  "addressSnapshot" TEXT NOT NULL,
  "templateSnapshot" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
  "suppressionReason" TEXT,
  "overlapReason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "providerReceiptId" TEXT,
  "messageId" UUID,
  "phoneCallId" UUID,
  "acceptedAt" TIMESTAMPTZ(3),
  "deliveredAt" TIMESTAMPTZ(3),
  "respondedAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "lastError" TEXT,
  "costCents" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_campaign_recipients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_campaign_recipients_status_check" CHECK ("status" IN ('PREVIEWED','SUPPRESSED','OVERLAP_BLOCKED','QUEUED','PROCESSING','ACCEPTED','DELIVERED','RESPONDED','RETRY_PENDING','FAILED','CANCELLED')),
  CONSTRAINT "outbound_campaign_recipients_attempt_check" CHECK ("attemptCount" BETWEEN 0 AND 5),
  CONSTRAINT "outbound_campaign_recipients_cost_check" CHECK ("costCents" >= 0)
);
CREATE UNIQUE INDEX "outbound_campaign_recipients_workspaceId_id_key" ON "outbound_campaign_recipients"("workspaceId","id");
CREATE UNIQUE INDEX "outbound_campaign_recipients_workspaceId_campaignId_leadId_key" ON "outbound_campaign_recipients"("workspaceId","campaignId","leadId");
CREATE UNIQUE INDEX "outbound_campaign_recipients_workspaceId_idempotencyKey_key" ON "outbound_campaign_recipients"("workspaceId","idempotencyKey");
CREATE INDEX "outbound_campaign_recipients_workspaceId_campaignId_status_nextAttemptAt_idx" ON "outbound_campaign_recipients"("workspaceId","campaignId","status","nextAttemptAt");
CREATE INDEX "outbound_campaign_recipients_workspaceId_leadId_createdAt_idx" ON "outbound_campaign_recipients"("workspaceId","leadId","createdAt");

CREATE TABLE "outbound_campaign_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "recipientId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "providerReceiptId" TEXT,
  "errorCode" TEXT,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "finishedAt" TIMESTAMPTZ(3) NOT NULL,
  "simulated" BOOLEAN NOT NULL DEFAULT TRUE,
  "externalEgress" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbound_campaign_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbound_campaign_attempts_number_check" CHECK ("attemptNumber" BETWEEN 1 AND 5),
  CONSTRAINT "outbound_campaign_attempts_status_check" CHECK ("status" IN ('ACCEPTED','RETRY_PENDING','FAILED')),
  CONSTRAINT "outbound_campaign_attempts_egress_check" CHECK ("externalEgress" = FALSE)
);
CREATE UNIQUE INDEX "outbound_campaign_attempts_workspaceId_id_key" ON "outbound_campaign_attempts"("workspaceId","id");
CREATE UNIQUE INDEX "outbound_campaign_attempts_workspaceId_recipientId_attemptNumber_key" ON "outbound_campaign_attempts"("workspaceId","recipientId","attemptNumber");
CREATE INDEX "outbound_campaign_attempts_workspaceId_status_createdAt_idx" ON "outbound_campaign_attempts"("workspaceId","status","createdAt");

ALTER TABLE "outbound_campaigns"
  ADD CONSTRAINT "outbound_campaigns_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outbound_campaigns_created_actor_fkey" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outbound_campaigns_updated_actor_fkey" FOREIGN KEY ("workspaceId","updatedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outbound_campaigns_approved_actor_fkey" FOREIGN KEY ("workspaceId","approvedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outbound_campaigns_cancelled_actor_fkey" FOREIGN KEY ("workspaceId","cancelledByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbound_campaign_recipients"
  ADD CONSTRAINT "outbound_campaign_recipients_campaign_fkey" FOREIGN KEY ("workspaceId","campaignId") REFERENCES "outbound_campaigns"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outbound_campaign_recipients_lead_fkey" FOREIGN KEY ("workspaceId","leadId") REFERENCES "leads"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outbound_campaign_recipients_contact_fkey" FOREIGN KEY ("workspaceId","contactId") REFERENCES "contacts"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outbound_campaign_recipients_contact_point_fkey" FOREIGN KEY ("workspaceId","contactPointId") REFERENCES "contact_points"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbound_campaign_recipients"
  ADD CONSTRAINT "outbound_campaign_recipients_message_fkey" FOREIGN KEY ("workspaceId","messageId") REFERENCES "messages"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "outbound_campaign_recipients_phone_call_fkey" FOREIGN KEY ("workspaceId","phoneCallId") REFERENCES "phone_calls"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbound_campaign_attempts"
  ADD CONSTRAINT "outbound_campaign_attempts_recipient_fkey" FOREIGN KEY ("workspaceId","recipientId") REFERENCES "outbound_campaign_recipients"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id","key","description","createdAt") VALUES
  (md5('permission:outbound_campaigns.read')::uuid, 'outbound_campaigns.read', 'Consultar campanhas de comunicação e recibos', CURRENT_TIMESTAMP),
  (md5('permission:outbound_campaigns.manage')::uuid, 'outbound_campaigns.manage', 'Configurar e pré-visualizar campanhas de comunicação', CURRENT_TIMESTAMP),
  (md5('permission:outbound_campaigns.approve')::uuid, 'outbound_campaigns.approve', 'Aprovar público congelado e ações pós-envio', CURRENT_TIMESTAMP),
  (md5('permission:outbound_campaigns.execute')::uuid, 'outbound_campaigns.execute', 'Executar, cancelar e reprocessar campanhas de comunicação', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id","workspaceId","roleId","permissionId","scope","createdByActorId","createdAt")
SELECT md5(w.id::text || ':' || r.id::text || ':' || p.key)::uuid, w.id, r.id, p.id, 'WORKSPACE'::"PermissionScope", a.id, CURRENT_TIMESTAMP
FROM "workspaces" w
JOIN "roles" r ON r."workspaceId" = w.id AND r.key = 'administrator' AND r."deletedAt" IS NULL
JOIN "actors" a ON a."workspaceId" = w.id AND a.key = 'system'
JOIN "permissions" p ON p.key IN ('outbound_campaigns.read','outbound_campaigns.manage','outbound_campaigns.approve','outbound_campaigns.execute')
ON CONFLICT ("workspaceId","roleId","permissionId") DO NOTHING;

REVOKE ALL ON TABLE "outbound_campaigns", "outbound_campaign_recipients", "outbound_campaign_attempts" FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE "outbound_campaigns", "outbound_campaign_recipients", "outbound_campaign_attempts" TO service_role;
