import { describe, expect, it } from "vitest";
import { canScheduleAdvertisingMeeting } from "./advertising-scheduling-policy";
describe("agendamento de Anúncios", () => {
  it("permite SDR e exceções administrativas; vendedor só agenda como scheduler explícito", () => {
    expect(canScheduleAdvertisingMeeting("sdr", false)).toBe(true);
    expect(canScheduleAdvertisingMeeting("administrator", false)).toBe(true);
    expect(canScheduleAdvertisingMeeting("commercial_manager", false)).toBe(true);
    expect(canScheduleAdvertisingMeeting("closer", false)).toBe(false);
    expect(canScheduleAdvertisingMeeting("closer", true)).toBe(true);
    expect(canScheduleAdvertisingMeeting("viewer", false)).toBe(false);
  });
});
