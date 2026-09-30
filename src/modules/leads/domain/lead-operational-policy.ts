export const STALE_CONTACT_HOURS = 72;

export function staleContactCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_CONTACT_HOURS * 60 * 60 * 1_000);
}
