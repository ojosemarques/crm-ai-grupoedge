import { addLocalDays, parseWorkspaceLocalDateTime, workspaceDateAt } from "@/shared/core/time/workspace-time";

export const PUBLIC_AGENDA_ZONE = "America/Sao_Paulo";
export const PUBLIC_AGENDA_MINUTES = 30;
export const PUBLIC_AGENDA_TITLE = "Reunião de diagnóstico";
export const PUBLIC_AGENDA_SELLERS = {
  "jhoncunha@politizai.com": 9,
  "ederafael@politizai.com": 11,
} as const;

export type AgendaSlot = { day: string; hour: number; startsAt: Date; endsAt: Date };
export type BusyInterval = { startsAt: Date; endsAt: Date };

export function publicAgendaWindow(now: Date) {
  const today = workspaceDateAt(now, PUBLIC_AGENDA_ZONE);
  const days = [today, addLocalDays(today, 1), addLocalDays(today, 2)];
  const slots = days.flatMap((day) => Array.from({ length: 10 }, (_, index): AgendaSlot => {
    const hour = index + 9;
    const startsAt = parseWorkspaceLocalDateTime(`${day}T${String(hour).padStart(2, "0")}:00`, PUBLIC_AGENDA_ZONE);
    return { day, hour, startsAt, endsAt: new Date(startsAt.getTime() + PUBLIC_AGENDA_MINUTES * 60_000) };
  })).filter(({ startsAt }) => startsAt > now);
  return { today, days, slots };
}

export function isSellerAvailable(slot: AgendaSlot, opensAt: number, intervals: readonly BusyInterval[]) {
  return slot.hour >= opensAt && !intervals.some(({ startsAt, endsAt }) => startsAt < slot.endsAt && endsAt > slot.startsAt);
}
