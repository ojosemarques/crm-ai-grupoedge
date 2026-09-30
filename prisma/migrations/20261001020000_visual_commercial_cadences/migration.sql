CREATE TYPE "CadenceStepAction" AS ENUM ('WHATSAPP', 'CALL', 'EMAIL', 'RECYCLE', 'CLOSE');

ALTER TABLE "cadence_steps"
ADD COLUMN "action" "CadenceStepAction" NOT NULL DEFAULT 'CALL';

ALTER TABLE "cadence_steps" DISABLE TRIGGER "cadence_steps_no_update_or_delete_trigger";

UPDATE "cadence_steps" AS step
SET "action" = CASE
  WHEN step."attemptNumber" = 1 THEN 'WHATSAPP'::"CadenceStepAction"
  WHEN step."attemptNumber" = 2 THEN 'CALL'::"CadenceStepAction"
  WHEN step."attemptNumber" = 3 THEN 'EMAIL'::"CadenceStepAction"
  WHEN step."attemptNumber" = 4 THEN 'WHATSAPP'::"CadenceStepAction"
  WHEN step."attemptNumber" = (
    SELECT MAX(last_step."attemptNumber")
    FROM "cadence_steps" AS last_step
    WHERE last_step."workspaceId" = step."workspaceId"
      AND last_step."settingsVersionId" = step."settingsVersionId"
  ) THEN 'RECYCLE'::"CadenceStepAction"
  ELSE 'CALL'::"CadenceStepAction"
END;

ALTER TABLE "cadence_steps" ENABLE TRIGGER "cadence_steps_no_update_or_delete_trigger";
