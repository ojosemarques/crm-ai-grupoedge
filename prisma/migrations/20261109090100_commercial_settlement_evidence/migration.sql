ALTER TABLE "payments"
  ADD COLUMN "netSettledCents" BIGINT,
  ADD COLUMN "netUpfrontCents" BIGINT,
  ADD CONSTRAINT "payments_net_settlement_values" CHECK (
    ("netSettledCents" IS NULL OR "netSettledCents" BETWEEN 0 AND "amountCents")
    AND ("netUpfrontCents" IS NULL OR (
      "netSettledCents" IS NOT NULL AND "netUpfrontCents" BETWEEN 0 AND "netSettledCents"
    ))
  );

ALTER TABLE "ote_plans"
  ADD COLUMN "rampMonth" TEXT,
  ADD COLUMN "rampEvidence" TEXT,
  ADD CONSTRAINT "ote_plans_ramp_evidence" CHECK (
    ("rampMonth" IS NULL AND "rampEvidence" IS NULL)
    OR ("rampMonth" IS NOT NULL AND "rampMonth" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
      AND "rampEvidence" IS NOT NULL AND length(trim("rampEvidence")) > 0)
  );

CREATE TABLE "commercial_compensation_policies" (
  "workspaceId" UUID NOT NULL,
  "version" TEXT NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedById" UUID NOT NULL,
  CONSTRAINT "commercial_compensation_policies_pkey" PRIMARY KEY ("workspaceId", "version"),
  CONSTRAINT "commercial_compensation_policy_workspace_fk" FOREIGN KEY ("workspaceId")
    REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_compensation_policy_actor_fk" FOREIGN KEY ("workspaceId", "recordedById")
    REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commercial_compensation_policy_version" CHECK (length(trim("version")) > 0)
);
CREATE UNIQUE INDEX "commercial_compensation_policies_workspaceId_effectiveDate_key"
  ON "commercial_compensation_policies"("workspaceId", "effectiveDate");
CREATE INDEX "commercial_compensation_policies_workspaceId_recordedById_idx"
  ON "commercial_compensation_policies"("workspaceId", "recordedById");

DO $$ BEGIN
  IF current_schema() = 'crm' THEN
    REVOKE ALL ON "commercial_compensation_policies" FROM PUBLIC, anon, authenticated, service_role, crm_politizai_runtime;
    GRANT SELECT ON "commercial_compensation_policies" TO crm_politizai_runtime;
  END IF;
END $$;
