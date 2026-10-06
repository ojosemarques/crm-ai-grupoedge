-- Validate the normalized representation of the new contact channels.
SET search_path TO crm, public;

ALTER TABLE "contact_points"
  ADD CONSTRAINT "contact_points_whatsapp_check" CHECK (
    "type" <> 'WHATSAPP' OR "normalizedValue" ~ '^\+[1-9][0-9]{7,14}$'
  ),
  ADD CONSTRAINT "contact_points_instagram_check" CHECK (
    "type" <> 'INSTAGRAM'
    OR (
      length(btrim("normalizedValue")) BETWEEN 2 AND 160
      AND "normalizedValue" = lower(btrim("normalizedValue"))
    )
  );

-- Materialize channels already verified by Politizai Pesquisa. Existing PHONE
-- points remain untouched because current messaging integrations depend on them.
INSERT INTO "contact_points" (
  "id", "workspaceId", "contactId", "type", "originalValue", "normalizedValue",
  "label", "isPrimary", "verificationStatus", "quality", "source", "doNotContact",
  "verifiedAt", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), candidate."workspaceId", lead."contactId",
  'WHATSAPP'::"ContactPointType", candidate."whatsapp", candidate."normalizedWhatsapp",
  CASE candidate."whatsappScope"::text
    WHEN 'POLITICIAN' THEN 'Direto'
    WHEN 'ADVISOR' THEN 'Assessoria'
    ELSE 'Gabinete'
  END,
  false, 'VERIFIED'::"ContactPointVerificationStatus", 'VALID'::"ContactPointQuality",
  'LEAD_INTAKE'::"ContactOrigin", lead."contactPreference" = 'DO_NOT_CONTACT'::"ContactPreference",
  candidate."mandateVerifiedAt", lead."updatedByActorId", lead."updatedByActorId",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "prospect_candidates" AS candidate
INNER JOIN "leads" AS lead
  ON lead."workspaceId" = candidate."workspaceId"
 AND lead."id" = candidate."leadId"
WHERE candidate."status" = 'RELEASED'::"ProspectCandidateStatus"
  AND lead."contactId" IS NOT NULL
  AND candidate."whatsapp" IS NOT NULL
  AND candidate."normalizedWhatsapp" IS NOT NULL
  AND candidate."whatsappScope" IS NOT NULL
ON CONFLICT ("workspaceId", "contactId", "type", "normalizedValue")
  WHERE "deletedAt" IS NULL
DO UPDATE SET
  "label" = COALESCE("contact_points"."label", EXCLUDED."label"),
  "verificationStatus" = 'VERIFIED'::"ContactPointVerificationStatus",
  "quality" = 'VALID'::"ContactPointQuality",
  "doNotContact" = "contact_points"."doNotContact" OR EXCLUDED."doNotContact",
  "verifiedAt" = EXCLUDED."verifiedAt",
  "updatedByActorId" = EXCLUDED."updatedByActorId",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "contact_points" (
  "id", "workspaceId", "contactId", "type", "originalValue", "normalizedValue",
  "label", "isPrimary", "verificationStatus", "quality", "source", "doNotContact",
  "verifiedAt", "createdByActorId", "updatedByActorId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), candidate."workspaceId", lead."contactId",
  'INSTAGRAM'::"ContactPointType", candidate."instagram", lower(btrim(candidate."instagram")),
  CASE candidate."instagramScope"::text
    WHEN 'POLITICIAN' THEN 'Direto'
    WHEN 'ADVISOR' THEN 'Assessoria'
    ELSE 'Gabinete'
  END,
  false, 'VERIFIED'::"ContactPointVerificationStatus", 'VALID'::"ContactPointQuality",
  'LEAD_INTAKE'::"ContactOrigin", lead."contactPreference" = 'DO_NOT_CONTACT'::"ContactPreference",
  candidate."mandateVerifiedAt", lead."updatedByActorId", lead."updatedByActorId",
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "prospect_candidates" AS candidate
INNER JOIN "leads" AS lead
  ON lead."workspaceId" = candidate."workspaceId"
 AND lead."id" = candidate."leadId"
WHERE candidate."status" = 'RELEASED'::"ProspectCandidateStatus"
  AND lead."contactId" IS NOT NULL
  AND candidate."instagram" IS NOT NULL
  AND candidate."instagramScope" IS NOT NULL
ON CONFLICT ("workspaceId", "contactId", "type", "normalizedValue")
  WHERE "deletedAt" IS NULL
DO UPDATE SET
  "label" = COALESCE("contact_points"."label", EXCLUDED."label"),
  "verificationStatus" = 'VERIFIED'::"ContactPointVerificationStatus",
  "quality" = 'VALID'::"ContactPointQuality",
  "doNotContact" = "contact_points"."doNotContact" OR EXCLUDED."doNotContact",
  "verifiedAt" = EXCLUDED."verifiedAt",
  "updatedByActorId" = EXCLUDED."updatedByActorId",
  "updatedAt" = CURRENT_TIMESTAMP;
