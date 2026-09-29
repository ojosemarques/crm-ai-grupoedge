-- PROD-09: rate limit compartilhado entre instâncias web.
-- Não armazena IP, e-mail, usuário ou workspace em claro: somente hash SHA-256.

CREATE TABLE "request_rate_limits" (
  "namespace" VARCHAR(80) NOT NULL,
  "subjectHash" CHAR(64) NOT NULL,
  "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "requestCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "request_rate_limits_pkey" PRIMARY KEY ("namespace", "subjectHash"),
  CONSTRAINT "request_rate_limits_namespace_check" CHECK ("namespace" ~ '^[a-z0-9][a-z0-9:_-]{0,79}$'),
  CONSTRAINT "request_rate_limits_count_check" CHECK ("requestCount" > 0),
  CONSTRAINT "request_rate_limits_window_check" CHECK ("expiresAt" > "windowStartedAt")
);

CREATE INDEX "request_rate_limits_expiresAt_idx" ON "request_rate_limits"("expiresAt");

REVOKE UPDATE ("namespace", "subjectHash", "windowStartedAt", "expiresAt", "createdAt")
  ON "request_rate_limits" FROM PUBLIC;

-- O papel existe somente nos ambientes remotos. O bloco mantém a migration
-- reproduzível em local/test e concede apenas o DML necessário ao runtime.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_politizai_runtime') THEN
    GRANT SELECT, DELETE ON "request_rate_limits" TO crm_politizai_runtime;
    GRANT INSERT ("namespace", "subjectHash", "windowStartedAt", "expiresAt", "requestCount", "createdAt", "updatedAt")
      ON "request_rate_limits" TO crm_politizai_runtime;
    GRANT UPDATE ("windowStartedAt", "expiresAt", "requestCount", "updatedAt")
      ON "request_rate_limits" TO crm_politizai_runtime;
  END IF;
END
$$;
