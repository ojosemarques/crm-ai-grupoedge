CREATE TABLE "ote_plans" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "memberId" UUID NOT NULL,
  "effectiveMonth" TEXT NOT NULL, "label" TEXT NOT NULL, "role" TEXT NOT NULL,
  "fixedCents" BIGINT NOT NULL, "quotaCents" BIGINT NOT NULL, "bonusCents" BIGINT NOT NULL,
  "meetingQuota" INTEGER NOT NULL DEFAULT 20, "salesQuota" INTEGER NOT NULL DEFAULT 4,
  "revision" INTEGER NOT NULL DEFAULT 1, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ote_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ote_plans_member_fk" FOREIGN KEY ("workspaceId", "memberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ote_plans_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ote_plans_values" CHECK ("role" IN ('CLOSER','SDR') AND "fixedCents" >= 0 AND "quotaCents" >= 0 AND "bonusCents" >= 0 AND ("role" = 'SDR' OR "quotaCents" > 0) AND "meetingQuota" > 0 AND "salesQuota" > 0 AND "effectiveMonth" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$')
);
CREATE UNIQUE INDEX "ote_plans_workspaceId_memberId_effectiveMonth_key" ON "ote_plans"("workspaceId", "memberId", "effectiveMonth");
CREATE TABLE "ote_sales" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "opportunityId" UUID NOT NULL, "sellerMemberId" UUID NOT NULL,
  "kind" TEXT NOT NULL, "acvCents" BIGINT NOT NULL, "selfSourced" BOOLEAN NOT NULL DEFAULT false,
  "sdrMemberId" UUID, "evidence" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1, "updatedByActorId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ote_sales_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ote_sales_opportunity_fk" FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ote_sales_seller_fk" FOREIGN KEY ("workspaceId", "sellerMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ote_sales_sdr_fk" FOREIGN KEY ("workspaceId", "sdrMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ote_sales_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ote_sales_values" CHECK ("acvCents" >= 0 AND "kind" IN ('ANNUAL_MONTHLY','ANNUAL_UPFRONT','PROJECT','EXPANSION','RENEWAL','AUTO_RENEWAL','LOW_TICKET'))
);
CREATE UNIQUE INDEX "ote_sales_workspaceId_opportunityId_key" ON "ote_sales"("workspaceId", "opportunityId");
CREATE INDEX "ote_sales_workspaceId_sellerMemberId_idx" ON "ote_sales"("workspaceId", "sellerMemberId");
CREATE INDEX "ote_sales_workspaceId_sdrMemberId_idx" ON "ote_sales"("workspaceId", "sdrMemberId");
CREATE TABLE "ote_meetings" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "meetingId" UUID NOT NULL, "sdrMemberId" UUID NOT NULL,
  "qualified" BOOLEAN NOT NULL, "evidence" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByActorId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ote_meetings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ote_meetings_meeting_fk" FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ote_meetings_sdr_fk" FOREIGN KEY ("workspaceId", "sdrMemberId") REFERENCES "workspace_members"("workspaceId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ote_meetings_actor_fk" FOREIGN KEY ("workspaceId", "updatedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ote_meetings_workspaceId_meetingId_key" ON "ote_meetings"("workspaceId", "meetingId");
CREATE INDEX "ote_meetings_workspaceId_sdrMemberId_idx" ON "ote_meetings"("workspaceId", "sdrMemberId");
-- The CRM uses a private schema and server-side sessions, not Supabase JWTs.
-- Public API roles must never receive compensation data.
DO $$ BEGIN
  IF current_schema() = 'crm' THEN
    REVOKE ALL ON "ote_plans", "ote_sales", "ote_meetings" FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE ON "ote_plans", "ote_sales", "ote_meetings" TO crm_politizai_runtime;
  END IF;
END $$;

-- Initial Politizai plans bind to verified membership IDs, never display names.
-- Other workspaces and disposable demo databases are unaffected.
INSERT INTO "ote_plans" ("id", "workspaceId", "memberId", "effectiveMonth", "label", "role", "fixedCents", "quotaCents", "bonusCents", "meetingQuota", "salesQuota", "updatedByActorId", "updatedAt")
SELECT gen_random_uuid(), m."workspaceId", m.id, '2026-10', p.label, p.role,
       p.fixed, p.quota, p.bonus, 20, 4, a.id, CURRENT_TIMESTAMP
FROM (VALUES
  ('77ab66e3-bd01-42ff-a297-e307d0750ff7'::uuid, 'Jhon — Sênior', 'CLOSER', 370000::bigint, 6000000::bigint, 120000::bigint),
  ('2dae1348-a2c9-47b1-aa6b-448d2a52b772'::uuid, 'Ede — Júnior', 'CLOSER', 250000::bigint, 3500000::bigint, 70000::bigint),
  ('6c2a85a6-c739-4a83-b41d-dbbf283f2eb4'::uuid, 'Carlos — SDR', 'SDR', 200000::bigint, 0::bigint, 0::bigint)
) AS p(member_id, label, role, fixed, quota, bonus)
JOIN "workspace_members" m ON m.id = p.member_id AND m."workspaceId" = 'f99613d9-f4a1-449e-a19f-ed9ec3d46105'::uuid AND m.status = 'ACTIVE' AND m."deletedAt" IS NULL
CROSS JOIN LATERAL (
  SELECT actor.id FROM "actors" actor
  JOIN "workspace_members" administrator ON administrator."workspaceId" = actor."workspaceId" AND administrator."userId" = actor."userId"
  JOIN "roles" role ON role."workspaceId" = administrator."workspaceId" AND role.id = administrator."roleId"
  WHERE actor."workspaceId" = m."workspaceId" AND actor.type = 'HUMAN' AND role.key = 'administrator'
    AND administrator.status = 'ACTIVE' AND administrator."deletedAt" IS NULL
  ORDER BY administrator."createdAt", actor.id LIMIT 1
) a
ON CONFLICT ("workspaceId", "memberId", "effectiveMonth") DO NOTHING;
