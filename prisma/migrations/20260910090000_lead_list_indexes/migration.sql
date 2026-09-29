-- CRM-09: support server-side operational filters without denormalizing facts.
CREATE INDEX "leads_workspaceId_stateCode_city_deletedAt_idx"
  ON "leads"("workspaceId", "stateCode", "city", "deletedAt");

CREATE INDEX "leads_workspaceId_jobTitle_deletedAt_idx"
  ON "leads"("workspaceId", "jobTitle", "deletedAt");

CREATE INDEX "leads_workspaceId_budgetCents_deletedAt_idx"
  ON "leads"("workspaceId", "budgetCents", "deletedAt");
