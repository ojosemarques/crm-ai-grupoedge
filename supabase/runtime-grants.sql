-- Run after the Prisma migrations and after creating crm_politizai_runtime.
-- The web role receives DML only; Prisma migration history stays private.
GRANT USAGE ON SCHEMA crm TO crm_politizai_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA crm TO crm_politizai_runtime;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'crm'
      AND tablename NOT IN ('_prisma_migrations', 'request_rate_limits')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE crm.%I TO crm_politizai_runtime',
      item.tablename
    );
  END LOOP;
END
$$;

-- Preserve the narrower column grants from the rate-limit migration.
GRANT SELECT, DELETE ON crm.request_rate_limits TO crm_politizai_runtime;
GRANT INSERT ("namespace", "subjectHash", "windowStartedAt", "expiresAt", "requestCount", "createdAt", "updatedAt")
  ON crm.request_rate_limits TO crm_politizai_runtime;
GRANT UPDATE ("windowStartedAt", "expiresAt", "requestCount", "updatedAt")
  ON crm.request_rate_limits TO crm_politizai_runtime;
