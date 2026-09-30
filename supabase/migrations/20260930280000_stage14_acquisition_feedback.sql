SET search_path TO crm, public;

-- Stage 14 least-privilege machine scopes for the versioned CRM and acquisition APIs.
ALTER TYPE "N8nMachineScope" ADD VALUE IF NOT EXISTS 'RECORDS_WRITE';

-- Keep external delivery provenance distinct from local simulators.
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'DELIVERED_EXTERNAL';
ALTER TABLE "outbox_events" ADD COLUMN "deliveredExternallyAt" TIMESTAMPTZ(3);

GRANT SELECT, INSERT, UPDATE ON TABLE "outbox_events" TO service_role;
