ALTER TABLE "daily_goal_profiles"
  ADD COLUMN "meetingsCompletedTarget" INTEGER,
  ADD COLUMN "weeklySalesTarget" INTEGER,
  ADD CONSTRAINT "daily_goal_profiles_meetings_completed_check" CHECK ("meetingsCompletedTarget" BETWEEN 0 AND 100000),
  ADD CONSTRAINT "daily_goal_profiles_weekly_sales_check" CHECK ("weeklySalesTarget" BETWEEN 0 AND 100000);
