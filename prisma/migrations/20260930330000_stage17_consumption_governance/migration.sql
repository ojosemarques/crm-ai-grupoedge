CREATE TYPE "ConsumptionResourceType" AS ENUM ('AI', 'SMS', 'VOICE', 'PROVIDER');
CREATE TYPE "ConsumptionBudgetStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');
CREATE TYPE "ConsumptionLedgerKind" AS ENUM ('DEBIT', 'CREDIT', 'BLOCKED');

CREATE TABLE "consumption_budgets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "resourceType" "ConsumptionResourceType" NOT NULL,
  "resourceKey" TEXT NOT NULL,
  "status" "ConsumptionBudgetStatus" NOT NULL DEFAULT 'ACTIVE',
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "limitCents" BIGINT,
  "limitUnits" BIGINT,
  "includedCreditCents" BIGINT NOT NULL DEFAULT 0,
  "warningBasisPoints" INTEGER NOT NULL DEFAULT 8000,
  "periodStart" TIMESTAMPTZ(3) NOT NULL,
  "periodEnd" TIMESTAMPTZ(3) NOT NULL,
  "pausedAt" TIMESTAMPTZ(3),
  "pausedReason" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "consumption_budgets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consumption_budgets_resource_key_check" CHECK (char_length("resourceKey") BETWEEN 2 AND 120),
  CONSTRAINT "consumption_budgets_currency_check" CHECK (char_length("currency") = 3),
  CONSTRAINT "consumption_budgets_limit_check" CHECK (("limitCents" IS NOT NULL OR "limitUnits" IS NOT NULL) AND COALESCE("limitCents", 0) >= 0 AND COALESCE("limitUnits", 0) >= 0 AND "includedCreditCents" >= 0),
  CONSTRAINT "consumption_budgets_warning_check" CHECK ("warningBasisPoints" BETWEEN 1 AND 10000),
  CONSTRAINT "consumption_budgets_period_check" CHECK ("periodStart" < "periodEnd"),
  CONSTRAINT "consumption_budgets_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "consumption_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "budgetId" UUID NOT NULL,
  "resourceType" "ConsumptionResourceType" NOT NULL,
  "resourceKey" TEXT NOT NULL,
  "kind" "ConsumptionLedgerKind" NOT NULL,
  "amountCents" BIGINT NOT NULL DEFAULT 0,
  "units" BIGINT NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL,
  "externalReference" TEXT,
  "reason" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "actorId" UUID NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consumption_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consumption_ledger_entries_values_check" CHECK ("amountCents" >= 0 AND "units" >= 0 AND ("amountCents" > 0 OR "units" > 0)),
  CONSTRAINT "consumption_ledger_entries_idempotency_check" CHECK (char_length("idempotencyKey") BETWEEN 8 AND 160)
);

CREATE UNIQUE INDEX "consumption_budgets_workspaceId_id_key" ON "consumption_budgets"("workspaceId", "id");
CREATE UNIQUE INDEX "consumption_budgets_workspaceId_resourceType_resourceKey_periodStart_key" ON "consumption_budgets"("workspaceId", "resourceType", "resourceKey", "periodStart");
CREATE INDEX "consumption_budgets_workspaceId_status_periodEnd_idx" ON "consumption_budgets"("workspaceId", "status", "periodEnd");
CREATE UNIQUE INDEX "consumption_ledger_entries_workspaceId_id_key" ON "consumption_ledger_entries"("workspaceId", "id");
CREATE UNIQUE INDEX "consumption_ledger_entries_workspaceId_idempotencyKey_key" ON "consumption_ledger_entries"("workspaceId", "idempotencyKey");
CREATE INDEX "consumption_ledger_entries_workspaceId_budgetId_occurredAt_idx" ON "consumption_ledger_entries"("workspaceId", "budgetId", "occurredAt");
CREATE INDEX "consumption_ledger_entries_workspaceId_resourceType_resourceKey_occurredAt_idx" ON "consumption_ledger_entries"("workspaceId", "resourceType", "resourceKey", "occurredAt");

ALTER TABLE "consumption_budgets" ADD CONSTRAINT "consumption_budgets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consumption_budgets" ADD CONSTRAINT "consumption_budgets_createdByActorId_fkey" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consumption_budgets" ADD CONSTRAINT "consumption_budgets_updatedByActorId_fkey" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consumption_ledger_entries" ADD CONSTRAINT "consumption_ledger_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consumption_ledger_entries" ADD CONSTRAINT "consumption_ledger_entries_budgetId_fkey" FOREIGN KEY ("workspaceId", "budgetId") REFERENCES "consumption_budgets"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consumption_ledger_entries" ADD CONSTRAINT "consumption_ledger_entries_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION crm_stage17_reject_consumption_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consumption ledger is append-only';
END;
$$;

CREATE TRIGGER "consumption_ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "consumption_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION crm_stage17_reject_consumption_ledger_mutation();
