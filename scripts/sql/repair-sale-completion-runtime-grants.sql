-- Restore the existing private-schema runtime contract for closing a sale.
-- The closing transition reads the plan and cancels active episodes/tracks/waits.
-- This intentionally restores only the operations needed by that transition.
GRANT SELECT, UPDATE ON TABLE
  crm.opportunity_account_plans,
  crm.opportunity_plan_episodes,
  crm.opportunity_plan_tracks,
  crm.opportunity_planned_waits
TO crm_politizai_runtime;
