-- Allow one connected Google account to keep CRM -> Google projection while
-- disabling Google -> CRM imports independently.
ALTER TABLE "google_calendar_accounts"
  ADD COLUMN "pullEnabled" BOOLEAN NOT NULL DEFAULT TRUE;
