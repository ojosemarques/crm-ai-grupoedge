SET search_path TO crm, public;

CREATE TYPE "WhatsAppAlternativeChannelStatus" AS ENUM ('NOT_DEFINED', 'PENDING_HOMOLOGATION', 'AUTHORIZED');

ALTER TABLE "whatsapp_connection_profiles"
  ADD COLUMN "policyDecisionScope" TEXT,
  ADD COLUMN "policyDecisionRationale" TEXT,
  ADD COLUMN "policySourceUrl" TEXT,
  ADD COLUMN "policySourceObservedAt" TIMESTAMPTZ(3),
  ADD COLUMN "policyDecidedAt" TIMESTAMPTZ(3),
  ADD COLUMN "policyDecidedByActorId" UUID,
  ADD COLUMN "policyReviewTrigger" TEXT,
  ADD COLUMN "alternativeChannel" "ConversationChannel",
  ADD COLUMN "alternativeChannelStatus" "WhatsAppAlternativeChannelStatus" NOT NULL DEFAULT 'NOT_DEFINED',
  ADD COLUMN "alternativeChannelDetail" TEXT;

CREATE TABLE "whatsapp_policy_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "eligibility" "WhatsAppPolicyEligibility" NOT NULL,
  "scope" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "sourceObservedAt" TIMESTAMPTZ(3) NOT NULL,
  "reviewTrigger" TEXT NOT NULL,
  "alternativeChannel" "ConversationChannel",
  "alternativeChannelStatus" "WhatsAppAlternativeChannelStatus" NOT NULL,
  "alternativeChannelDetail" TEXT,
  "decidedByActorId" UUID NOT NULL,
  "decidedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_policy_decisions_pkey" PRIMARY KEY ("id")
);

UPDATE "whatsapp_connection_profiles" AS profile
SET
  "policyEligibility" = 'INELIGIBLE',
  "policyDecisionScope" = 'CRM comercial e serviços da Politizai para gabinetes, mandatos, campanhas e outros participantes do ecossistema político.',
  "policyDecisionRationale" = 'A política vigente proíbe a Plataforma do WhatsApp Business para entidades não governamentais que prestam serviços relacionados a política, candidatos, estratégia ou serviços de campanha e soluções eleitorais; o escopo comercial documentado da Politizai está dentro dessa fronteira.',
  "policySourceUrl" = 'https://business.whatsapp.com/policy/preview?lang=pt_BR',
  "policySourceObservedAt" = TIMESTAMPTZ '2026-09-30 03:00:00+00',
  "policyDecidedAt" = CURRENT_TIMESTAMP,
  "policyDecidedByActorId" = COALESCE((
    SELECT actor."id"
    FROM "actors" AS actor
    WHERE actor."workspaceId" = profile."workspaceId" AND actor."type" = 'SYSTEM'
    ORDER BY actor."createdAt", actor."id"
    LIMIT 1
  ), profile."createdByActorId"),
  "policyReviewTrigger" = 'Reavaliar somente após mudança publicada da política ou confirmação escrita da Meta/provedor que autorize explicitamente o escopo da Politizai.',
  "alternativeChannel" = 'PHONE',
  "alternativeChannelStatus" = 'AUTHORIZED',
  "alternativeChannelDetail" = 'Contato humano manual por telefone, com registro da atividade no CRM; sem envio automatizado ou provider externo implícito.';

INSERT INTO "whatsapp_policy_decisions" (
  "workspaceId", "profileId", "eligibility", "scope", "rationale", "sourceUrl", "sourceObservedAt", "reviewTrigger",
  "alternativeChannel", "alternativeChannelStatus", "alternativeChannelDetail", "decidedByActorId", "decidedAt"
)
SELECT
  profile."workspaceId", profile."id", profile."policyEligibility", profile."policyDecisionScope", profile."policyDecisionRationale",
  profile."policySourceUrl", profile."policySourceObservedAt", profile."policyReviewTrigger", profile."alternativeChannel",
  profile."alternativeChannelStatus", profile."alternativeChannelDetail", profile."policyDecidedByActorId", profile."policyDecidedAt"
FROM "whatsapp_connection_profiles" AS profile
WHERE profile."policyDecidedByActorId" IS NOT NULL;

INSERT INTO "audit_logs" ("id", "workspaceId", "actorId", "action", "entityType", "entityId", "origin", "reason", "occurredAt", "changes")
SELECT
  gen_random_uuid(), profile."workspaceId", profile."policyDecidedByActorId", 'integration.whatsapp.policy_decided',
  'WhatsAppConnectionProfile', profile."id", 'DOMAIN', profile."policyDecisionRationale", profile."policyDecidedAt",
  jsonb_build_object(
    'decision', profile."policyEligibility",
    'scope', profile."policyDecisionScope",
    'sourceUrl', profile."policySourceUrl",
    'sourceObservedAt', profile."policySourceObservedAt",
    'alternativeChannel', profile."alternativeChannel",
    'alternativeStatus', profile."alternativeChannelStatus",
    'externalEgress', false,
    'migration', '20260930150000_stage08_whatsapp_policy_gate'
  )
FROM "whatsapp_connection_profiles" AS profile
WHERE profile."policyDecidedByActorId" IS NOT NULL;

ALTER TABLE "whatsapp_connection_profiles"
  ADD CONSTRAINT "whatsapp_connection_profiles_policy_decider_fkey"
  FOREIGN KEY ("workspaceId", "policyDecidedByActorId") REFERENCES "actors"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_policy_decisions"
  ADD CONSTRAINT "whatsapp_policy_decisions_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "whatsapp_policy_decisions_profile_fkey" FOREIGN KEY ("workspaceId", "profileId") REFERENCES "whatsapp_connection_profiles"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "whatsapp_policy_decisions_actor_fkey" FOREIGN KEY ("workspaceId", "decidedByActorId") REFERENCES "actors"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "whatsapp_policy_decisions_workspaceId_id_key" ON "whatsapp_policy_decisions"("workspaceId", "id");
CREATE INDEX "whatsapp_policy_decisions_workspaceId_profileId_decidedAt_idx" ON "whatsapp_policy_decisions"("workspaceId", "profileId", "decidedAt");
CREATE INDEX "whatsapp_policy_decisions_workspaceId_eligibility_decidedAt_idx" ON "whatsapp_policy_decisions"("workspaceId", "eligibility", "decidedAt");

CREATE INDEX "whatsapp_connection_profiles_workspaceId_policyEligibility_idx"
  ON "whatsapp_connection_profiles"("workspaceId", "policyEligibility", "alternativeChannelStatus");

CREATE OR REPLACE FUNCTION prevent_stage08_append_only_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage08 policy decision facts are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "whatsapp_policy_decisions_append_only"
BEFORE UPDATE OR DELETE ON "whatsapp_policy_decisions"
FOR EACH ROW EXECUTE FUNCTION prevent_stage08_append_only_mutation();

REVOKE ALL ON TABLE "whatsapp_policy_decisions" FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE "whatsapp_policy_decisions" TO service_role;
