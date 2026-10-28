import { describe, expect, it } from "vitest";

import {
  nextRealtimePollDelay,
  REALTIME_DASHBOARD_SLIDE_COUNT,
  REALTIME_DASHBOARD_SLIDE_DURATION_MS,
  REALTIME_DASHBOARD_STALE_AFTER_MS,
  REALTIME_TV_PAGE_RELOAD_INTERVAL_MS,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-polling";

describe("temporização do dashboard tempo real", () => {
  it("mantém quatro slides de sessenta segundos", () => {
    expect(REALTIME_DASHBOARD_SLIDE_COUNT).toBe(4);
    expect(REALTIME_DASHBOARD_SLIDE_DURATION_MS).toBe(60_000);
    expect(REALTIME_TV_PAGE_RELOAD_INTERVAL_MS).toBe(1_800_000);
  });

  it("aplica polling normal, economia em aba oculta e backoff limitado", () => {
    expect(nextRealtimePollDelay({ succeeded: true, failureCount: 0, hidden: false, fullscreen: false })).toBe(5_000);
    expect(nextRealtimePollDelay({ succeeded: true, failureCount: 0, hidden: true, fullscreen: false })).toBe(60_000);
    expect(nextRealtimePollDelay({ succeeded: true, failureCount: 0, hidden: true, fullscreen: true })).toBe(5_000);
    expect(nextRealtimePollDelay({ succeeded: false, failureCount: 1, hidden: false, fullscreen: false, jitterMs: 500 })).toBe(30_500);
    expect(nextRealtimePollDelay({ succeeded: false, failureCount: 2, hidden: false, fullscreen: false })).toBe(60_000);
    expect(nextRealtimePollDelay({ succeeded: false, failureCount: 8, hidden: false, fullscreen: false, jitterMs: 2_000 })).toBe(121_500);
    expect(REALTIME_DASHBOARD_STALE_AFTER_MS).toBe(45_000);
  });
});
