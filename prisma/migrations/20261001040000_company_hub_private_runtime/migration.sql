-- The backend authenticates local users and scopes all operations by membership.
-- This private database role serves every company; it is never issued to browsers.
-- Preserve RLS and existing grants. Public Supabase roles receive no policy.
DO $migration$
DECLARE
  target_schema text := current_schema();
  target_table text;
  active_company text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    RETURN;
  END IF;
  FOREACH target_table IN ARRAY ARRAY[
    'financial_categories', 'financial_accounts', 'financial_entries',
    'commission_rules', 'commissions',
    'analytics_dashboards', 'analytics_widgets', 'analytics_mutation_receipts',
    'consumption_budgets', 'consumption_ledger_entries',
    'delivery_plans', 'delivery_checklist_items', 'handoff_transfer_versions'
  ] LOOP
    active_company := format('"workspaceId" IN (SELECT id FROM %I.workspaces WHERE status = ''ACTIVE'' AND "deletedAt" IS NULL)', target_schema);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', target_schema, target_table);
    EXECUTE format('CREATE POLICY company_runtime_select ON %I.%I FOR SELECT TO crm_politizai_runtime USING (%s)', target_schema, target_table, active_company);
    EXECUTE format('CREATE POLICY company_runtime_insert ON %I.%I FOR INSERT TO crm_politizai_runtime WITH CHECK (%s)', target_schema, target_table, active_company);
    EXECUTE format('CREATE POLICY company_runtime_update ON %I.%I FOR UPDATE TO crm_politizai_runtime USING (%s) WITH CHECK (%s)', target_schema, target_table, active_company, active_company);
  END LOOP;
END
$migration$;
