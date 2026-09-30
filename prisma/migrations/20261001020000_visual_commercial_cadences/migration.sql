CREATE TYPE "CadenceStepAction" AS ENUM ('WHATSAPP', 'CALL', 'EMAIL', 'RECYCLE', 'CLOSE');

ALTER TABLE "cadence_steps"
ADD COLUMN "action" "CadenceStepAction" NOT NULL DEFAULT 'CALL';
