-- Keep the session actor invariant independent of the caller's search_path.
-- Hyperdrive connections do not guarantee the same startup search_path used by
-- the migration connection that originally created this trigger function.
DO $migration$
DECLARE
  target_schema text := current_schema();
BEGIN
  EXECUTE format($function$
    CREATE OR REPLACE FUNCTION %1$I."enforce_auth_session_human_actor"()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $body$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM %1$I."actors" AS actor
        WHERE actor."workspaceId" = NEW."workspaceId"
          AND actor."id" = NEW."actorId"
          AND actor."type" = 'HUMAN'
          AND actor."userId" = NEW."userId"
      )
      THEN
        RAISE EXCEPTION 'auth session requires the matching human actor'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $body$;
  $function$, target_schema);
END;
$migration$;
