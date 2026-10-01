-- The private backend creates official-metric dashboards through authorized services.
-- Existing company RLS remains enforced; no public or delete/update grants are added.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    EXECUTE format('GRANT SELECT, INSERT ON %I.analytics_dashboards, %I.analytics_widgets, %I.analytics_mutation_receipts TO crm_politizai_runtime', current_schema(), current_schema(), current_schema());
  END IF;
END
$migration$;
