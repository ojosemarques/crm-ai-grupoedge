export const REALTIME_DASHBOARD_SLIDE_COUNT = 4;
export const REALTIME_DASHBOARD_SLIDE_DURATION_MS = 60_000;
export const REALTIME_DASHBOARD_STALE_AFTER_MS = 45_000;
export const REALTIME_DASHBOARD_REQUEST_TIMEOUT_MS = 30_000;
export const REALTIME_TV_PAGE_RELOAD_INTERVAL_MS = 30 * 60_000;

export function nextRealtimePollDelay(input: Readonly<{
  succeeded: boolean;
  failureCount: number;
  hidden: boolean;
  fullscreen: boolean;
  jitterMs?: number;
}>): number {
  if (input.hidden && !input.fullscreen) return 60_000;
  if (input.succeeded) return 5_000;
  const backoff = Math.min(30_000, 5_000 * (2 ** Math.max(0, input.failureCount - 1)));
  return backoff + Math.max(0, Math.min(1_500, input.jitterMs ?? 0));
}
