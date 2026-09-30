-- Stage 14 exposes the governed machine credential to the versioned CRM API
-- and to approved acquisition adapters with least-privilege scopes.
ALTER TYPE "N8nMachineScope" ADD VALUE IF NOT EXISTS 'RECORDS_WRITE';

-- External provider delivery must never be reported as a local delivery.
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'DELIVERED_EXTERNAL';
ALTER TABLE "outbox_events" ADD COLUMN "deliveredExternallyAt" TIMESTAMPTZ(3);
