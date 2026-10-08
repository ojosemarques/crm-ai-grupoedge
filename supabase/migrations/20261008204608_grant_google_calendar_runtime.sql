BEGIN;

SET LOCAL search_path TO crm, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "google_calendar_accounts", "google_calendar_oauth_states", "google_calendar_event_links"
      TO crm_politizai_runtime;
  END IF;
END $$;

COMMIT;
