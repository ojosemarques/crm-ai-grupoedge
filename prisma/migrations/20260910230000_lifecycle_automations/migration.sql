ALTER TYPE "AutomationTriggerType" ADD VALUE 'CALL_UNANSWERED';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'LEAD_QUALIFIED';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'MEETING_SCHEDULED';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'MEETING_NO_SHOW';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'LEAD_STAGNANT';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'LEAD_WITHOUT_NEXT_ACTION';
ALTER TYPE "AutomationTriggerType" ADD VALUE 'OPPORTUNITY_CLOSED';
ALTER TYPE "AutomationActionType" ADD VALUE 'APPLY_LIFECYCLE_AUTOMATION';

ALTER TABLE "automation_runs"
  ADD COLUMN "meetingId" UUID,
  ADD COLUMN "opportunityId" UUID;

ALTER TABLE "activities" ADD COLUMN "automationRunId" UUID;
ALTER TABLE "tasks" ADD COLUMN "automationRunId" UUID;
ALTER TABLE "messages" ADD COLUMN "automationRunId" UUID;
ALTER TABLE "notifications" ADD COLUMN "automationRunId" UUID;
ALTER TABLE "customer_handoffs" ADD COLUMN "automationRunId" UUID;

CREATE INDEX "automation_runs_workspaceId_meetingId_status_triggeredAt_idx"
  ON "automation_runs"("workspaceId", "meetingId", "status", "triggeredAt");
CREATE INDEX "automation_runs_workspaceId_opportunityId_status_triggeredAt_idx"
  ON "automation_runs"("workspaceId", "opportunityId", "status", "triggeredAt");
CREATE INDEX "activities_workspaceId_automationRunId_idx"
  ON "activities"("workspaceId", "automationRunId");
CREATE INDEX "tasks_workspaceId_automationRunId_idx"
  ON "tasks"("workspaceId", "automationRunId");
CREATE INDEX "messages_workspaceId_automationRunId_idx"
  ON "messages"("workspaceId", "automationRunId");
CREATE INDEX "notifications_workspaceId_automationRunId_createdAt_idx"
  ON "notifications"("workspaceId", "automationRunId", "createdAt");
CREATE INDEX "customer_handoffs_workspaceId_automationRunId_idx"
  ON "customer_handoffs"("workspaceId", "automationRunId");

ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspaceId_meetingId_fkey"
  FOREIGN KEY ("workspaceId", "meetingId") REFERENCES "meetings"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspaceId_opportunityId_fkey"
  FOREIGN KEY ("workspaceId", "opportunityId") REFERENCES "opportunities"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspaceId_automationRunId_fkey"
  FOREIGN KEY ("workspaceId", "automationRunId") REFERENCES "automation_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_automationRunId_fkey"
  FOREIGN KEY ("workspaceId", "automationRunId") REFERENCES "automation_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspaceId_automationRunId_fkey"
  FOREIGN KEY ("workspaceId", "automationRunId") REFERENCES "automation_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspaceId_automationRunId_fkey"
  FOREIGN KEY ("workspaceId", "automationRunId") REFERENCES "automation_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_handoffs" ADD CONSTRAINT "customer_handoffs_workspaceId_automationRunId_fkey"
  FOREIGN KEY ("workspaceId", "automationRunId") REFERENCES "automation_runs"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
