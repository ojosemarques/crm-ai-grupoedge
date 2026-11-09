ALTER TABLE "ote_plans"
  ADD COLUMN "advertisingBand60Cents" BIGINT,
  ADD COLUMN "advertisingBand80Cents" BIGINT,
  ADD COLUMN "advertisingBand100Cents" BIGINT,
  ADD COLUMN "advertisingBonusCents" BIGINT,
  ADD CONSTRAINT "ote_advertising_amounts" CHECK (
    num_nonnulls("advertisingBand60Cents", "advertisingBand80Cents", "advertisingBand100Cents", "advertisingBonusCents") = 0
    OR (num_nonnulls("advertisingBand60Cents", "advertisingBand80Cents", "advertisingBand100Cents", "advertisingBonusCents") = 4
      AND "role" = 'SDR' AND "advertisingBand60Cents" >= 0
      AND "advertisingBand80Cents" >= "advertisingBand60Cents"
      AND "advertisingBand100Cents" >= "advertisingBand80Cents" AND "advertisingBonusCents" >= 0)
  );

CREATE TABLE "sdr_advertising_snapshots" (
  "workspaceId" UUID NOT NULL,
  "memberId" UUID NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "periodKind" TEXT NOT NULL,
  "periodStartOn" DATE NOT NULL,
  "periodEndOn" DATE NOT NULL,
  "revision" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "facts" JSONB NOT NULL,
  "evaluatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "sdr_advertising_snapshots_pkey" PRIMARY KEY ("workspaceId", "memberId", "periodKind", "periodStartOn", "revision"),
  CONSTRAINT "sdr_advertising_snapshot_policy_fk" FOREIGN KEY ("workspaceId", "policyVersion") REFERENCES "commercial_compensation_policies" ("workspaceId", "version") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sdr_advertising_snapshot_member_fk" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "workspace_members" ("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sdr_advertising_snapshot_values" CHECK (
    "periodKind" IN ('DAY', 'WEEK', 'MONTH') AND "periodStartOn" < "periodEndOn"
    AND "revision" > 0 AND length("fingerprint") = 64 AND jsonb_typeof("facts") = 'object'
  )
);
CREATE INDEX "sdr_advertising_snapshot_policy_idx" ON "sdr_advertising_snapshots" ("workspaceId", "policyVersion");

DO $$ BEGIN
  IF current_schema() = 'crm' THEN
    REVOKE ALL ON "sdr_advertising_snapshots" FROM PUBLIC, anon, authenticated, service_role, crm_politizai_runtime;
    GRANT SELECT, INSERT ON "sdr_advertising_snapshots" TO crm_politizai_runtime;
  END IF;
END $$;
