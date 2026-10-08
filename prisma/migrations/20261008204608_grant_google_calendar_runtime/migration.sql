-- Google Calendar credentials remain server-only. The dedicated CRM runtime
-- role needs DML access; Supabase Data API roles stay revoked.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "google_calendar_accounts", "google_calendar_oauth_states", "google_calendar_event_links"
      TO crm_politizai_runtime;
  END IF;
END $$;
