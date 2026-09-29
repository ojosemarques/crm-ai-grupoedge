-- Prisma owns the CRM tables; keep them outside Supabase's exposed public schema.
CREATE SCHEMA crm AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA crm FROM PUBLIC, anon, authenticated, service_role;

-- Keep future Prisma objects inaccessible to the Data API roles.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA crm
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA crm
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA crm
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
