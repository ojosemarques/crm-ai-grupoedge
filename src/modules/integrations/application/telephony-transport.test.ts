import { describe, expect, it } from "vitest";

import { LocalTelephonySimulatorAdapter, TelephonyTransportError } from "@/modules/integrations/application/telephony-transport";
import { telephonyScenarios } from "@/modules/integrations/domain/telephony-contracts";

describe("adaptador de telefonia local", () => {
  const adapter = new LocalTelephonySimulatorAdapter();
  const base = { callId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "call:test-1", attempt: 1, startedAt: new Date("2046-06-03T12:00:00Z") };

  it.each(telephonyScenarios.filter((scenario) => !["TRANSIENT_FAILURE", "PERMANENT_FAILURE", "TIMEOUT"].includes(scenario)))("executa %s sem egress, gravação ou transcrição", async (scenario) => {
    const result = await adapter.start({ ...base, scenario });
    expect(result.externalEgress).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(adapter.getRecordingReference()).toBeNull();
  });

  it("faz a falha transitória convergir deterministicamente na terceira tentativa", async () => {
    await expect(adapter.start({ ...base, scenario: "TRANSIENT_FAILURE", attempt: 1 })).rejects.toMatchObject({ code: "TELEPHONY_LOCAL_TRANSIENT_FAILURE", retryable: true });
    await expect(adapter.start({ ...base, scenario: "TRANSIENT_FAILURE", attempt: 2 })).rejects.toBeInstanceOf(TelephonyTransportError);
    await expect(adapter.start({ ...base, scenario: "TRANSIENT_FAILURE", attempt: 3 })).resolves.toMatchObject({ simulated: true, externalEgress: false });
  });

  it("classifica falha permanente e timeout", async () => {
    await expect(adapter.start({ ...base, scenario: "PERMANENT_FAILURE" })).rejects.toMatchObject({ retryable: false });
    await expect(adapter.start({ ...base, scenario: "TIMEOUT" })).rejects.toMatchObject({ retryable: true });
  });
});
