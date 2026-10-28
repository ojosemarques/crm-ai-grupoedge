import { addLocalDays } from "@/shared/core/time/workspace-time";

export const marketingPeriodShortcuts = [["TODAY", "Hoje"], ["YESTERDAY", "Ontem"], ["LAST_7_DAYS", "7 dias"], ["MONTH", "Mês"], ["LAST_30_DAYS", "30 dias"]] as const;
export type MarketingPeriodPreset = (typeof marketingPeriodShortcuts)[number][0];

export function marketingDateRanges(today: string): Record<MarketingPeriodPreset, { from: string; to: string }> {
  return {
    TODAY: { from: today, to: today },
    YESTERDAY: { from: addLocalDays(today, -1), to: addLocalDays(today, -1) },
    LAST_7_DAYS: { from: addLocalDays(today, -6), to: today },
    MONTH: { from: `${today.slice(0, 7)}-01`, to: today },
    LAST_30_DAYS: { from: addLocalDays(today, -29), to: today },
  };
}
