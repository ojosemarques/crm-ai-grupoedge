CREATE OR REPLACE FUNCTION crm45_protect_email_message_fact()
RETURNS trigger AS $$
BEGIN
  IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
    OR NEW."profileId" IS DISTINCT FROM OLD."profileId"
    OR NEW."messageId" IS DISTINCT FROM OLD."messageId"
    OR NEW."messageIdHeader" IS DISTINCT FROM OLD."messageIdHeader"
    OR NEW."inReplyToHeader" IS DISTINCT FROM OLD."inReplyToHeader"
    OR NEW."referencesHeaders" IS DISTINCT FROM OLD."referencesHeaders"
    OR NEW."textBodyHash" IS DISTINCT FROM OLD."textBodyHash"
    OR NEW."htmlBodyHash" IS DISTINCT FROM OLD."htmlBodyHash"
    OR NEW."hasSanitizedHtml" IS DISTINCT FROM OLD."hasSanitizedHtml"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'CRM-45 immutable email message fact cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_message_profiles_protect_fact
BEFORE UPDATE ON "email_message_profiles"
FOR EACH ROW EXECUTE FUNCTION crm45_protect_email_message_fact();

CREATE TRIGGER email_recipients_append_only
BEFORE UPDATE OR DELETE ON "email_recipients"
FOR EACH ROW EXECUTE FUNCTION crm43_reject_append_only_change();

CREATE OR REPLACE FUNCTION crm45_protect_email_review_fact()
RETURNS trigger AS $$
BEGIN
  IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
    OR NEW."profileId" IS DISTINCT FROM OLD."profileId"
    OR NEW."emailMessageId" IS DISTINCT FROM OLD."emailMessageId"
    OR NEW."messageId" IS DISTINCT FROM OLD."messageId"
    OR NEW."eventKey" IS DISTINCT FROM OLD."eventKey"
    OR NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode"
    OR NEW."evidence" IS DISTINCT FROM OLD."evidence"
    OR NEW."createdByActorId" IS DISTINCT FROM OLD."createdByActorId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'CRM-45 immutable email review fact cannot be rewritten';
  END IF;
  IF (NEW."status" = 'OPEN' AND (NEW."resolvedAt" IS NOT NULL OR NEW."resolvedByActorId" IS NOT NULL))
    OR (NEW."status" <> 'OPEN' AND (NEW."resolvedAt" IS NULL OR NEW."resolvedByActorId" IS NULL))
  THEN
    RAISE EXCEPTION 'CRM-45 email review resolution is inconsistent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_event_reviews_protect_fact
BEFORE UPDATE ON "email_event_reviews"
FOR EACH ROW EXECUTE FUNCTION crm45_protect_email_review_fact();

ALTER TABLE "email_connection_profiles"
  ADD CONSTRAINT "email_profile_external_mode_guard" CHECK (
    "operatingMode" <> 'EXTERNAL_READY'
    OR ("smtpHost" IS NOT NULL AND "smtpPort" IS NOT NULL AND "validatedAt" IS NOT NULL)
  );
