SET search_path TO crm, public;

BEGIN;

REVOKE ALL ON TABLE
  "marketing_form_receipts",
  "marketing_form_events",
  "marketing_form_rotation_states"
FROM PUBLIC;

DO $migration$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE %I, %I, %I FROM %I',
        'marketing_form_receipts',
        'marketing_form_events',
        'marketing_form_rotation_states',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON
      "marketing_form_receipts",
      "marketing_form_rotation_states"
    TO crm_politizai_runtime;

    GRANT SELECT, INSERT ON
      "marketing_form_events"
    TO crm_politizai_runtime;
  END IF;
END
$migration$;

COMMIT;
