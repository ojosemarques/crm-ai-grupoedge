-- Gestão financeira integrada. Os fatos comerciais existentes continuam canônicos:
-- Invoice/Payment para contas a receber e caixa, RevenueMovement para MRR e
-- Opportunity/ContractVersion para vendas. Estas tabelas guardam apenas fatos
-- financeiros manuais e comissões, evitando duplicação contábil.

CREATE TYPE "FinancialCategoryKind" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "FinancialAccountType" AS ENUM ('CASH', 'BANK', 'OTHER');
CREATE TYPE "FinancialEntryDirection" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "FinancialEntryStatus" AS ENUM ('PLANNED', 'SETTLED', 'CANCELLED');
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');

CREATE TABLE "financial_categories" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "FinancialCategoryKind" NOT NULL,
  "dreGroup" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "financial_category_key_ck" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,79}$'),
  CONSTRAINT "financial_category_name_ck" CHECK (length(trim("name")) BETWEEN 2 AND 120)
);

CREATE TABLE "financial_accounts" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "type" "FinancialAccountType" NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "openingBalanceCents" BIGINT NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "financial_account_name_ck" CHECK (length(trim("name")) BETWEEN 2 AND 120)
);

CREATE TABLE "financial_entries" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "financialAccountId" UUID NOT NULL,
  "customerAccountId" UUID,
  "direction" "FinancialEntryDirection" NOT NULL,
  "status" "FinancialEntryStatus" NOT NULL DEFAULT 'PLANNED',
  "description" TEXT NOT NULL,
  "counterparty" TEXT,
  "amountCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "competenceAt" TIMESTAMPTZ(3) NOT NULL,
  "dueAt" TIMESTAMPTZ(3) NOT NULL,
  "settledAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "cancellationReason" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "financial_entry_amount_ck" CHECK ("amountCents" > 0),
  CONSTRAINT "financial_entry_revision_ck" CHECK ("revision" > 0),
  CONSTRAINT "financial_entry_description_ck" CHECK (length(trim("description")) BETWEEN 3 AND 240),
  CONSTRAINT "financial_entry_state_ck" CHECK (
    ("status" = 'PLANNED' AND "settledAt" IS NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL)
    OR ("status" = 'SETTLED' AND "settledAt" IS NOT NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL)
    OR ("status" = 'CANCELLED' AND "settledAt" IS NULL AND "cancelledAt" IS NOT NULL AND length(trim("cancellationReason")) >= 8)
  )
);

CREATE TABLE "commission_rules" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "sellerMemberId" UUID NOT NULL,
  "percentageBps" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
  "effectiveTo" TIMESTAMPTZ(3),
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "commission_rule_percentage_ck" CHECK ("percentageBps" BETWEEN 0 AND 10000),
  CONSTRAINT "commission_rule_interval_ck" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "commission_rule_active_interval_ck" CHECK (NOT "active" OR "effectiveTo" IS NULL)
);

CREATE TABLE "commissions" (
  "id" UUID PRIMARY KEY,
  "workspaceId" UUID NOT NULL,
  "ruleId" UUID NOT NULL,
  "sellerMemberId" UUID NOT NULL,
  "opportunityId" UUID NOT NULL,
  "contractId" UUID,
  "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
  "basisCents" BIGINT NOT NULL,
  "percentageBps" INTEGER NOT NULL,
  "amountCents" BIGINT NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'BRL',
  "earnedAt" TIMESTAMPTZ(3) NOT NULL,
  "approvedAt" TIMESTAMPTZ(3),
  "approvedByActorId" UUID,
  "paidAt" TIMESTAMPTZ(3),
  "paidByActorId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByActorId" UUID NOT NULL,
  "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "commission_values_ck" CHECK ("basisCents" >= 0 AND "percentageBps" BETWEEN 0 AND 10000 AND "amountCents" >= 0),
  CONSTRAINT "commission_amount_ck" CHECK ("amountCents" = (("basisCents" * "percentageBps" + 5000) / 10000)),
  CONSTRAINT "commission_revision_ck" CHECK ("revision" > 0),
  CONSTRAINT "commission_state_ck" CHECK (
    ("status" = 'PENDING' AND "approvedAt" IS NULL AND "approvedByActorId" IS NULL AND "paidAt" IS NULL AND "paidByActorId" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "approvedByActorId" IS NOT NULL AND "paidAt" IS NULL AND "paidByActorId" IS NULL)
    OR ("status" = 'PAID' AND "approvedAt" IS NOT NULL AND "approvedByActorId" IS NOT NULL AND "paidAt" IS NOT NULL AND "paidByActorId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "financial_categories_workspace_id_key" ON "financial_categories"("workspaceId", "id");
CREATE UNIQUE INDEX "financial_categories_workspace_key_key" ON "financial_categories"("workspaceId", "key");
CREATE INDEX "financial_categories_workspace_kind_active_idx" ON "financial_categories"("workspaceId", "kind", "active", "name");
CREATE UNIQUE INDEX "financial_accounts_workspace_id_key" ON "financial_accounts"("workspaceId", "id");
CREATE UNIQUE INDEX "financial_accounts_workspace_name_key" ON "financial_accounts"("workspaceId", "name");
CREATE INDEX "financial_accounts_workspace_active_idx" ON "financial_accounts"("workspaceId", "active", "name");
CREATE UNIQUE INDEX "financial_entries_workspace_id_key" ON "financial_entries"("workspaceId", "id");
CREATE UNIQUE INDEX "financial_entries_workspace_idempotency_key" ON "financial_entries"("workspaceId", "idempotencyKey");
CREATE INDEX "financial_entries_workspace_status_due_idx" ON "financial_entries"("workspaceId", "status", "dueAt");
CREATE INDEX "financial_entries_workspace_direction_competence_idx" ON "financial_entries"("workspaceId", "direction", "competenceAt");
CREATE INDEX "financial_entries_workspace_account_settled_idx" ON "financial_entries"("workspaceId", "financialAccountId", "settledAt");
CREATE INDEX "financial_entries_workspace_customer_due_idx" ON "financial_entries"("workspaceId", "customerAccountId", "dueAt");
CREATE UNIQUE INDEX "commission_rules_workspace_id_key" ON "commission_rules"("workspaceId", "id");
CREATE UNIQUE INDEX "commission_rules_one_active_seller_idx" ON "commission_rules"("workspaceId", "sellerMemberId") WHERE "active";
CREATE INDEX "commission_rules_workspace_seller_effective_idx" ON "commission_rules"("workspaceId", "sellerMemberId", "active", "effectiveFrom");
CREATE UNIQUE INDEX "commissions_workspace_id_key" ON "commissions"("workspaceId", "id");
CREATE UNIQUE INDEX "commissions_workspace_idempotency_key" ON "commissions"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "commissions_workspace_opportunity_rule_key" ON "commissions"("workspaceId", "opportunityId", "ruleId");
CREATE INDEX "commissions_workspace_seller_status_idx" ON "commissions"("workspaceId", "sellerMemberId", "status", "earnedAt");
CREATE INDEX "commissions_workspace_status_paid_idx" ON "commissions"("workspaceId", "status", "paidAt");

ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_category_fk" FOREIGN KEY ("workspaceId", "categoryId") REFERENCES "financial_categories"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_account_fk" FOREIGN KEY ("workspaceId", "financialAccountId") REFERENCES "financial_accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_customer_fk" FOREIGN KEY ("workspaceId", "customerAccountId") REFERENCES "accounts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_seller_fk" FOREIGN KEY ("workspaceId", "sellerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_rule_fk" FOREIGN KEY ("workspaceId", "ruleId") REFERENCES "commission_rules"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_seller_fk" FOREIGN KEY ("workspaceId", "sellerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_opportunity_fk" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_contract_fk" FOREIGN KEY ("workspaceId", "contractId") REFERENCES "commercial_contracts"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_created_actor_fk" FOREIGN KEY ("workspaceId", "createdByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_updated_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_approved_actor_fk" FOREIGN KEY ("workspaceId", "approvedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_paid_actor_fk" FOREIGN KEY ("workspaceId", "paidByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT;

INSERT INTO "permissions" ("id", "key", "description", "createdAt") VALUES
  (md5('permission:finance.read')::uuid, 'finance.read', 'Consultar dados financeiros autorizados', CURRENT_TIMESTAMP),
  (md5('permission:finance.manage')::uuid, 'finance.manage', 'Gerenciar categorias, contas e lançamentos financeiros', CURRENT_TIMESTAMP),
  (md5('permission:finance.commissions')::uuid, 'finance.commissions', 'Gerenciar regras, aprovação e pagamento de comissões', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" (
  "id", "workspaceId", "roleId", "permissionId", "scope", "createdByActorId", "createdAt"
)
SELECT
  md5(role."workspaceId"::text || ':' || role.id::text || ':' || permission.key)::uuid,
  role."workspaceId",
  role.id,
  permission.id,
  'WORKSPACE'::"PermissionScope",
  role."createdByActorId",
  CURRENT_TIMESTAMP
FROM "roles" role
JOIN "permissions" permission ON permission.key IN ('finance.read', 'finance.manage', 'finance.commissions')
WHERE role.key IN ('administrator', 'commercial_manager') AND role."deletedAt" IS NULL
ON CONFLICT ("workspaceId", "roleId", "permissionId") DO UPDATE SET "scope" = EXCLUDED."scope";

-- Operadores comerciais deixam de receber indicadores e fatos financeiros por
-- padrão. Administradores ainda podem conceder permissões explicitamente.
DELETE FROM "role_permissions" role_permission
USING "roles" role, "permissions" permission
WHERE role_permission."workspaceId" = role."workspaceId"
  AND role_permission."roleId" = role.id
  AND role_permission."permissionId" = permission.id
  AND role.key IN ('sdr', 'closer', 'viewer')
  AND (
    permission.key = 'metrics.read'
    OR permission.key LIKE 'goals.%'
    OR permission.key LIKE 'forecast.%'
    OR permission.key LIKE 'revenue.%'
    OR permission.key LIKE 'payments.%'
  );
