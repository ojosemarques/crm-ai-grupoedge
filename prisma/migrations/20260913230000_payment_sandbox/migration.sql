CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT','OPEN','PARTIALLY_PAID','PAID','VOIDED','CANCELLED');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('QUEUED','PROCESSING','PROVIDER_ACCEPTED','DECLINED','RETRY_PENDING','DEAD_LETTER','CONFIRMED','CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('CONFIRMED','REVERSED','CHARGEDBACK');
CREATE TYPE "PaymentEventType" AS ENUM ('INVOICE_CREATED','INVOICE_ISSUED','INVOICE_VOIDED','ATTEMPT_QUEUED','ATTEMPT_STARTED','PROVIDER_ACCEPTED','ATTEMPT_DECLINED','ATTEMPT_RETRY_SCHEDULED','ATTEMPT_DEAD_LETTERED','PAYMENT_CONFIRMED','PAYMENT_REVERSED','CHARGEBACK_RECORDED','RECONCILIATION_REQUIRED','RECONCILIATION_RESOLVED','REPLAY_REQUESTED');
CREATE TYPE "PaymentSandboxScenario" AS ENUM ('SUCCESS','DECLINED','TIMEOUT','PERMANENT_FAILURE','CHARGEBACK','UNMATCHED');
CREATE TYPE "PaymentWebhookStatus" AS ENUM ('RECEIVED','PROCESSING','PROCESSED','RETRY_PENDING','DEAD_LETTER','REJECTED','REVIEW_REQUIRED');
CREATE TYPE "PaymentReconciliationIssueStatus" AS ENUM ('OPEN','RESOLVED','DISMISSED');
CREATE TYPE "PaymentReconciliationReason" AS ENUM ('UNMATCHED_INVOICE','AMBIGUOUS_REFERENCE','AMOUNT_MISMATCH','CURRENCY_MISMATCH','OUT_OF_ORDER','IDEMPOTENCY_CONFLICT');
CREATE TYPE "PaymentBackfillMode" AS ENUM ('DRY_RUN','EXECUTE');
CREATE TYPE "PaymentBackfillStatus" AS ENUM ('RUNNING','COMPLETED','FAILED');
CREATE TYPE "PaymentBackfillItemStatus" AS ENUM ('SKIPPED','REVIEW_REQUIRED');

ALTER TYPE "JobType" ADD VALUE 'PAYMENT_ATTEMPT';
ALTER TYPE "JobType" ADD VALUE 'PAYMENT_WEBHOOK';

CREATE TABLE "invoices" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "invoiceNumber" TEXT NOT NULL,
  "subscriptionId" UUID NOT NULL, "contractId" UUID NOT NULL, "accountId" UUID NOT NULL,
  "ownerMemberId" UUID NOT NULL, "accountNameSnapshot" TEXT NOT NULL,
  "contractNumberSnapshot" TEXT NOT NULL, "descriptionSnapshot" TEXT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL', "subtotalCents" BIGINT NOT NULL,
  "discountCents" BIGINT NOT NULL DEFAULT 0, "totalCents" BIGINT NOT NULL,
  "paidCents" BIGINT NOT NULL DEFAULT 0, "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "billingPeriodStart" TIMESTAMPTZ(3) NOT NULL, "billingPeriodEnd" TIMESTAMPTZ(3) NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL, "issuedAt" TIMESTAMPTZ(3), "paidAt" TIMESTAMPTZ(3),
  "voidedAt" TIMESTAMPTZ(3), "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "invoice_number_sequences" ("workspaceId" UUID PRIMARY KEY, "nextValue" BIGINT NOT NULL DEFAULT 1, "updatedAt" TIMESTAMPTZ(3) NOT NULL);
CREATE TABLE "invoice_lines" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "invoiceId" UUID NOT NULL,
  "position" INTEGER NOT NULL, "descriptionSnapshot" TEXT NOT NULL, "quantity" INTEGER NOT NULL,
  "unitPriceCents" BIGINT NOT NULL, "discountCents" BIGINT NOT NULL DEFAULT 0,
  "totalCents" BIGINT NOT NULL, "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "payment_attempts" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "invoiceId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL, "scenario" "PaymentSandboxScenario" NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'QUEUED', "amountCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL', "providerKey" TEXT NOT NULL DEFAULT 'LOCAL_PAYMENT_SANDBOX',
  "externalAttemptId" TEXT, "idempotencyKey" TEXT NOT NULL, "correlationId" TEXT NOT NULL,
  "causationId" TEXT, "outboxId" UUID, "jobId" UUID, "attempts" INTEGER NOT NULL DEFAULT 0,
  "acceptedAt" TIMESTAMPTZ(3), "confirmedAt" TIMESTAMPTZ(3), "failedAt" TIMESTAMPTZ(3),
  "errorCode" TEXT, "errorMessage" TEXT, "createdByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "payments" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "invoiceId" UUID NOT NULL, "attemptId" UUID,
  "amountCents" BIGINT NOT NULL, "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "status" "PaymentStatus" NOT NULL DEFAULT 'CONFIRMED', "providerKey" TEXT NOT NULL DEFAULT 'LOCAL_PAYMENT_SANDBOX',
  "externalPaymentId" TEXT, "idempotencyKey" TEXT NOT NULL, "correlationId" TEXT NOT NULL,
  "causationId" TEXT, "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reversedAt" TIMESTAMPTZ(3),
  "reversalReason" TEXT, "confirmedByActorId" UUID NOT NULL
);
CREATE TABLE "payment_events" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "invoiceId" UUID, "attemptId" UUID,
  "paymentId" UUID, "sequence" INTEGER NOT NULL, "type" "PaymentEventType" NOT NULL,
  "providerEventId" TEXT, "idempotencyKey" TEXT NOT NULL, "correlationId" TEXT NOT NULL,
  "causationId" TEXT, "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "actorId" UUID NOT NULL,
  "reason" TEXT NOT NULL, "safeMetadata" JSONB
);
CREATE TABLE "payment_webhook_receipts" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "providerKey" TEXT NOT NULL DEFAULT 'LOCAL_PAYMENT_SANDBOX',
  "providerEventId" TEXT NOT NULL, "eventType" TEXT NOT NULL, "contractVersion" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL, "nonceHash" TEXT NOT NULL, "payloadSizeBytes" INTEGER NOT NULL,
  "safePayload" JSONB, "signatureStatus" "WebhookSignatureStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "externalOccurredAt" TIMESTAMPTZ(3) NOT NULL, "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "PaymentWebhookStatus" NOT NULL DEFAULT 'RECEIVED', "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5, "lockedAt" TIMESTAMPTZ(3), "lockedBy" TEXT,
  "lockExpiresAt" TIMESTAMPTZ(3), "nextRetryAt" TIMESTAMPTZ(3), "errorCode" TEXT,
  "errorMessage" TEXT, "processedAt" TIMESTAMPTZ(3), "correlationId" TEXT NOT NULL, "jobId" UUID
);
CREATE TABLE "payment_reconciliation_issues" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "receiptId" UUID, "invoiceId" UUID,
  "attemptId" UUID, "paymentId" UUID, "reason" "PaymentReconciliationReason" NOT NULL,
  "status" "PaymentReconciliationIssueStatus" NOT NULL DEFAULT 'OPEN', "evidenceHash" TEXT NOT NULL,
  "safeEvidence" JSONB, "ownerMemberId" UUID, "resolvedByActorId" UUID,
  "resolutionReason" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "payment_backfill_runs" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "mode" "PaymentBackfillMode" NOT NULL,
  "status" "PaymentBackfillStatus" NOT NULL DEFAULT 'RUNNING', "idempotencyKey" TEXT NOT NULL,
  "actorId" UUID NOT NULL, "summary" JSONB, "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3)
);
CREATE TABLE "payment_backfill_items" (
  "id" UUID PRIMARY KEY, "workspaceId" UUID NOT NULL, "runId" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL, "status" "PaymentBackfillItemStatus" NOT NULL,
  "reason" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_number_key" UNIQUE ("workspaceId","invoiceNumber");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_period_key" UNIQUE ("workspaceId","subscriptionId","billingPeriodStart","billingPeriodEnd");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_fk" FOREIGN KEY ("workspaceId","subscriptionId") REFERENCES "subscriptions"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_fk" FOREIGN KEY ("workspaceId","contractId") REFERENCES "commercial_contracts"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_fk" FOREIGN KEY ("workspaceId","accountId") REFERENCES "accounts"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_owner_fk" FOREIGN KEY ("workspaceId","ownerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_actor_fk" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updated_actor_fk" FOREIGN KEY ("workspaceId","updatedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_ck" CHECK ("subtotalCents">=0 AND "discountCents">=0 AND "discountCents"<="subtotalCents" AND "totalCents"="subtotalCents"-"discountCents" AND "paidCents">=0 AND "paidCents"<="totalCents" AND "totalCents"<=9007199254740991);
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_period_ck" CHECK ("billingPeriodEnd">"billingPeriodStart" AND "revision">0);
ALTER TABLE "invoice_number_sequences" ADD CONSTRAINT "invoice_sequences_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "invoice_number_sequences" ADD CONSTRAINT "invoice_sequences_value_ck" CHECK ("nextValue">0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("workspaceId","invoiceId") REFERENCES "invoices"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_amount_ck" CHECK ("position">0 AND "quantity">0 AND "unitPriceCents">=0 AND "discountCents">=0 AND "totalCents">=0 AND "totalCents"<=("quantity"::bigint*"unitPriceCents") AND "totalCents"<=9007199254740991);

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoice_fk" FOREIGN KEY ("workspaceId","invoiceId") REFERENCES "invoices"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_outbox_fk" FOREIGN KEY ("workspaceId","outboxId") REFERENCES "outbox_events"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_job_fk" FOREIGN KEY ("workspaceId","jobId") REFERENCES "jobs"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_actor_fk" FOREIGN KEY ("workspaceId","createdByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_ck" CHECK ("sequence">0 AND "amountCents">0 AND "amountCents"<=9007199254740991 AND "attempts">=0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("workspaceId","invoiceId") REFERENCES "invoices"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payments" ADD CONSTRAINT "payments_attempt_fk" FOREIGN KEY ("workspaceId","attemptId") REFERENCES "payment_attempts"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payments" ADD CONSTRAINT "payments_actor_fk" FOREIGN KEY ("workspaceId","confirmedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_ck" CHECK ("amountCents">0 AND "amountCents"<=9007199254740991);
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_invoice_fk" FOREIGN KEY ("workspaceId","invoiceId") REFERENCES "invoices"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_attempt_fk" FOREIGN KEY ("workspaceId","attemptId") REFERENCES "payment_attempts"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_fk" FOREIGN KEY ("workspaceId","paymentId") REFERENCES "payments"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_actor_fk" FOREIGN KEY ("workspaceId","actorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_sequence_ck" CHECK ("sequence">0);
ALTER TABLE "payment_webhook_receipts" ADD CONSTRAINT "payment_receipts_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "payment_webhook_receipts" ADD CONSTRAINT "payment_receipts_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "payment_webhook_receipts" ADD CONSTRAINT "payment_receipts_job_fk" FOREIGN KEY ("workspaceId","jobId") REFERENCES "jobs"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_webhook_receipts" ADD CONSTRAINT "payment_receipts_limits_ck" CHECK ("payloadSizeBytes">0 AND "payloadSizeBytes"<=131072 AND "attempts">=0 AND "maxAttempts">0);
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_issues_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_issues_receipt_fk" FOREIGN KEY ("workspaceId","receiptId") REFERENCES "payment_webhook_receipts"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_issues_invoice_fk" FOREIGN KEY ("workspaceId","invoiceId") REFERENCES "invoices"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_issues_attempt_fk" FOREIGN KEY ("workspaceId","attemptId") REFERENCES "payment_attempts"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_issues_payment_fk" FOREIGN KEY ("workspaceId","paymentId") REFERENCES "payments"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_issues_owner_fk" FOREIGN KEY ("workspaceId","ownerMemberId") REFERENCES "workspace_members"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_reconciliation_issues" ADD CONSTRAINT "payment_issues_resolved_actor_fk" FOREIGN KEY ("workspaceId","resolvedByActorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_backfill_runs" ADD CONSTRAINT "payment_backfill_runs_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "payment_backfill_runs" ADD CONSTRAINT "payment_backfill_runs_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "payment_backfill_runs" ADD CONSTRAINT "payment_backfill_runs_actor_fk" FOREIGN KEY ("workspaceId","actorId") REFERENCES "actors"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_backfill_items" ADD CONSTRAINT "payment_backfill_items_workspace_id_key" UNIQUE ("workspaceId","id");
ALTER TABLE "payment_backfill_items" ADD CONSTRAINT "payment_backfill_items_run_fk" FOREIGN KEY ("workspaceId","runId") REFERENCES "payment_backfill_runs"("workspaceId","id") ON DELETE RESTRICT;
ALTER TABLE "payment_backfill_items" ADD CONSTRAINT "payment_backfill_items_subscription_fk" FOREIGN KEY ("workspaceId","subscriptionId") REFERENCES "subscriptions"("workspaceId","id") ON DELETE RESTRICT;

CREATE INDEX "invoices_scope_idx" ON "invoices"("workspaceId","ownerMemberId","status","dueAt");
CREATE INDEX "invoices_account_idx" ON "invoices"("workspaceId","accountId","status","dueAt");
CREATE INDEX "invoices_subscription_idx" ON "invoices"("workspaceId","subscriptionId","billingPeriodStart");
CREATE UNIQUE INDEX "invoice_lines_position_key" ON "invoice_lines"("workspaceId","invoiceId","position");
CREATE INDEX "payment_attempts_invoice_idx" ON "payment_attempts"("workspaceId","invoiceId","status","createdAt");
CREATE INDEX "payment_attempts_status_idx" ON "payment_attempts"("workspaceId","status","updatedAt");
CREATE UNIQUE INDEX "payment_attempts_sequence_key" ON "payment_attempts"("workspaceId","invoiceId","sequence");
CREATE UNIQUE INDEX "payment_attempts_idempotency_key" ON "payment_attempts"("workspaceId","idempotencyKey");
CREATE UNIQUE INDEX "payment_attempts_external_key" ON "payment_attempts"("workspaceId","providerKey","externalAttemptId") WHERE "externalAttemptId" IS NOT NULL;
CREATE INDEX "payments_invoice_idx" ON "payments"("workspaceId","invoiceId","occurredAt");
CREATE INDEX "payments_status_idx" ON "payments"("workspaceId","status","occurredAt");
CREATE UNIQUE INDEX "payments_idempotency_key" ON "payments"("workspaceId","idempotencyKey");
CREATE UNIQUE INDEX "payments_external_key" ON "payments"("workspaceId","providerKey","externalPaymentId") WHERE "externalPaymentId" IS NOT NULL;
CREATE INDEX "payment_events_invoice_idx" ON "payment_events"("workspaceId","invoiceId","sequence");
CREATE INDEX "payment_events_attempt_idx" ON "payment_events"("workspaceId","attemptId","occurredAt");
CREATE INDEX "payment_events_payment_idx" ON "payment_events"("workspaceId","paymentId","occurredAt");
CREATE UNIQUE INDEX "payment_events_idempotency_key" ON "payment_events"("workspaceId","idempotencyKey");
CREATE UNIQUE INDEX "payment_events_provider_event_key" ON "payment_events"("workspaceId","providerEventId") WHERE "providerEventId" IS NOT NULL;
CREATE INDEX "payment_receipts_status_idx" ON "payment_webhook_receipts"("workspaceId","status","nextRetryAt");
CREATE INDEX "payment_receipts_hash_idx" ON "payment_webhook_receipts"("workspaceId","payloadHash");
CREATE UNIQUE INDEX "payment_receipts_event_key" ON "payment_webhook_receipts"("workspaceId","providerKey","providerEventId");
CREATE UNIQUE INDEX "payment_receipts_nonce_key" ON "payment_webhook_receipts"("workspaceId","providerKey","nonceHash");
CREATE INDEX "payment_issues_status_idx" ON "payment_reconciliation_issues"("workspaceId","status","reason","createdAt");
CREATE INDEX "payment_issues_owner_idx" ON "payment_reconciliation_issues"("workspaceId","ownerMemberId","status");
CREATE UNIQUE INDEX "payment_issues_receipt_reason_key" ON "payment_reconciliation_issues"("workspaceId","receiptId","reason") WHERE "receiptId" IS NOT NULL;
CREATE INDEX "payment_backfill_runs_started_idx" ON "payment_backfill_runs"("workspaceId","startedAt");
CREATE UNIQUE INDEX "payment_backfill_runs_idempotency_key" ON "payment_backfill_runs"("workspaceId","idempotencyKey");
CREATE INDEX "payment_backfill_items_status_idx" ON "payment_backfill_items"("workspaceId","runId","status");
CREATE UNIQUE INDEX "payment_backfill_items_subscription_key" ON "payment_backfill_items"("workspaceId","runId","subscriptionId");

CREATE FUNCTION prevent_payment_fact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only payment fact: % is forbidden', TG_OP; END $$;
CREATE TRIGGER invoice_lines_append_only BEFORE UPDATE OR DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION prevent_payment_fact_mutation();
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION prevent_payment_fact_mutation();
CREATE TRIGGER payment_backfill_items_append_only BEFORE UPDATE OR DELETE ON "payment_backfill_items" FOR EACH ROW EXECUTE FUNCTION prevent_payment_fact_mutation();
CREATE TRIGGER payments_no_delete BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION prevent_payment_fact_mutation();
