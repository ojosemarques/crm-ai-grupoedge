-- Apply after the existing migrations, using the database owner.
-- Only the private server role is changed. No DELETE, public role, schema,
-- function, RLS policy or default privilege is changed.
-- These tables back finance, Copilot confirmation and the sale handoff.
BEGIN;

GRANT SELECT, INSERT, UPDATE ON TABLE
  crm.financial_categories,
  crm.financial_accounts,
  crm.financial_entries,
  crm.commission_rules,
  crm.commissions,
  crm.ai_assistant_proposals,
  crm.delivery_plans
TO crm_politizai_runtime;

-- Version/checklist records are append-only in the domain service.
GRANT SELECT, INSERT ON TABLE
  crm.handoff_transfer_versions,
  crm.delivery_checklist_items
TO crm_politizai_runtime;

COMMIT;
