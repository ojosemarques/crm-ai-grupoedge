BEGIN;

DO $migration$
DECLARE
  target_schema TEXT := current_schema();
  target_table TEXT;
  active_workspace TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON
      "prospecting_research_batches", "prospect_candidates", "prospect_candidate_sources",
      "prospect_releases", "prospecting_cadence_instances", "prospecting_cadence_steps",
      "prospecting_email_jobs", "prospecting_settings", "prospecting_seller_configs",
      "prospecting_reconciliation_states"
      TO crm_politizai_runtime;
    GRANT SELECT, INSERT ON
      "prospecting_email_template_versions", "prospecting_email_events", "open_dot_request_receipts"
      TO crm_politizai_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "prospecting_calendar_holidays"
      TO crm_politizai_runtime;

    active_workspace := format('"workspaceId" IN (SELECT id FROM %I.workspaces WHERE status = ''ACTIVE'' AND "deletedAt" IS NULL)', target_schema);
    FOREACH target_table IN ARRAY ARRAY[
      'prospecting_research_batches', 'prospect_candidates', 'prospect_candidate_sources',
      'prospect_releases', 'prospecting_cadence_instances', 'prospecting_cadence_steps',
      'prospecting_email_template_versions', 'prospecting_email_jobs', 'prospecting_email_events',
      'prospecting_calendar_holidays', 'prospecting_settings', 'prospecting_seller_configs',
      'open_dot_request_receipts', 'prospecting_reconciliation_states'
    ] LOOP
      EXECUTE format('CREATE POLICY company_runtime_select ON %I.%I FOR SELECT TO crm_politizai_runtime USING (%s)', target_schema, target_table, active_workspace);
      EXECUTE format('CREATE POLICY company_runtime_insert ON %I.%I FOR INSERT TO crm_politizai_runtime WITH CHECK (%s)', target_schema, target_table, active_workspace);
      EXECUTE format('CREATE POLICY company_runtime_update ON %I.%I FOR UPDATE TO crm_politizai_runtime USING (%s) WITH CHECK (%s)', target_schema, target_table, active_workspace, active_workspace);
    END LOOP;
    EXECUTE format('CREATE POLICY company_runtime_delete ON %I.%I FOR DELETE TO crm_politizai_runtime USING (%s)', target_schema, 'prospecting_calendar_holidays', active_workspace);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE ON
      "prospecting_research_batches", "prospect_candidates", "prospect_candidate_sources",
      "prospect_releases", "prospecting_cadence_instances", "prospecting_cadence_steps",
      "prospecting_email_jobs", "prospecting_settings", "prospecting_seller_configs",
      "prospecting_reconciliation_states"
      TO service_role;
    GRANT SELECT, INSERT ON
      "prospecting_email_template_versions", "prospecting_email_events", "open_dot_request_receipts"
      TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "prospecting_calendar_holidays"
      TO service_role;
  END IF;
END
$migration$;

COMMIT;
