import type { TelephonyCallStatus, TelephonyLegRole } from "@/generated/prisma/client";
import {
  TELEPHONY_PROVIDER_KEY,
  type TelephonyScenario,
} from "@/modules/integrations/domain/telephony-contracts";

type ProjectableTelephonyStatus = Exclude<TelephonyCallStatus, "REVIEW_REQUIRED">;

export type TelephonyAdapterEvent = Readonly<{
  eventId: string;
  status: ProjectableTelephonyStatus;
  sequence: number;
  occurredAt: Date;
  reasonCode?: string;
  leg?: Readonly<{ externalLegId: string; role: TelephonyLegRole; sequence: number }>;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type TelephonyStartCommand = Readonly<{
  callId: string;
  idempotencyKey: string;
  scenario: TelephonyScenario;
  attempt: number;
  startedAt: Date;
}>;

export type TelephonyAdapterResult = Readonly<{
  providerCallId: string;
  requestId: string;
  simulated: true;
  externalEgress: false;
  events: readonly TelephonyAdapterEvent[];
}>;

export interface TelephonyAdapter {
  readonly key: string;
  readonly providerKey: string;
  readonly externalEgress: false;
  start(command: TelephonyStartCommand): Promise<TelephonyAdapterResult>;
  cancel(callId: string, occurredAt: Date): Promise<readonly TelephonyAdapterEvent[]>;
  normalizeStatus(value: string): ProjectableTelephonyStatus;
  getRecordingReference(): null;
  verifyIdentity(): Readonly<{ verified: true; mode: "LOCAL_DETERMINISTIC" }>;
  health(): Promise<Readonly<{ ready: true; externalEgress: false; recording: false; transcription: false }>>;
}

export class TelephonyTransportError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "TelephonyTransportError";
  }
}

function event(command: TelephonyStartCommand, status: ProjectableTelephonyStatus, sequence: number, afterSeconds: number, extras: Partial<TelephonyAdapterEvent> = {}): TelephonyAdapterEvent {
  return {
    eventId: `local:${command.callId}:${command.attempt}:${sequence}:${status.toLowerCase()}`,
    status,
    sequence,
    occurredAt: new Date(command.startedAt.getTime() + afterSeconds * 1_000),
    metadata: { scenario: command.scenario, attempt: command.attempt, simulated: true },
    ...extras,
  };
}

export class LocalTelephonySimulatorAdapter implements TelephonyAdapter {
  readonly key = "telephony-channel-v1";
  readonly providerKey = TELEPHONY_PROVIDER_KEY;
  readonly externalEgress = false as const;

  async start(command: TelephonyStartCommand): Promise<TelephonyAdapterResult> {
    if (command.scenario === "PERMANENT_FAILURE") throw new TelephonyTransportError("TELEPHONY_LOCAL_PERMANENT_FAILURE", false);
    if (command.scenario === "TIMEOUT") throw new TelephonyTransportError("TELEPHONY_LOCAL_TIMEOUT", true);
    if (command.scenario === "TRANSIENT_FAILURE" && command.attempt < 3) throw new TelephonyTransportError("TELEPHONY_LOCAL_TRANSIENT_FAILURE", true);

    const common = [
      event(command, "INITIATED", 2, 1),
      event(command, "RINGING", 3, 2),
    ];
    let events: readonly TelephonyAdapterEvent[];
    switch (command.scenario) {
      case "BUSY": events = [...common, event(command, "BUSY", 4, 8)]; break;
      case "NO_ANSWER": events = [...common, event(command, "NO_ANSWER", 4, 30)]; break;
      case "CANCELLED": events = [event(command, "INITIATED", 2, 1), event(command, "CANCELLED", 3, 3)]; break;
      case "VOICEMAIL": events = [...common, event(command, "VOICEMAIL", 4, 25)]; break;
      case "MULTI_LEG_TRANSFER": events = [
        ...common,
        event(command, "ANSWERED", 4, 4),
        event(command, "RINGING", 5, 6, { leg: { externalLegId: `transfer:${command.callId}`, role: "TRANSFER_TARGET", sequence: 2 }, metadata: { scenario: command.scenario, attempt: command.attempt, transfer: true, simulated: true } }),
        event(command, "ANSWERED", 6, 9, { leg: { externalLegId: `transfer:${command.callId}`, role: "TRANSFER_TARGET", sequence: 2 } }),
        event(command, "COMPLETED", 7, 69, { leg: { externalLegId: `transfer:${command.callId}`, role: "TRANSFER_TARGET", sequence: 2 } }),
      ]; break;
      default: events = [...common, event(command, "ANSWERED", 4, 4), event(command, "COMPLETED", 5, 64)];
    }
    return {
      providerCallId: `local-call:${command.callId}`,
      requestId: `local-request:${command.callId}:${command.attempt}`,
      simulated: true,
      externalEgress: false,
      events,
    };
  }

  async cancel(callId: string, occurredAt: Date) {
    return [{ eventId: `local:${callId}:cancel`, status: "CANCELLED", sequence: 9_999, occurredAt, reasonCode: "USER_CANCELLED" }] as const;
  }

  normalizeStatus(value: string) {
    const normalized = value.trim().toUpperCase();
    const allowed = new Set<ProjectableTelephonyStatus>(["QUEUED", "INITIATED", "RINGING", "ANSWERED", "COMPLETED", "BUSY", "NO_ANSWER", "CANCELLED", "FAILED", "VOICEMAIL"]);
    if (!allowed.has(normalized as ProjectableTelephonyStatus)) throw new TelephonyTransportError("TELEPHONY_STATUS_UNKNOWN", false);
    return normalized as ProjectableTelephonyStatus;
  }

  getRecordingReference() { return null; }
  verifyIdentity() { return { verified: true as const, mode: "LOCAL_DETERMINISTIC" as const }; }
  async health() { return { ready: true as const, externalEgress: false as const, recording: false as const, transcription: false as const }; }
}

export class ExternalTelephonyDisabledAdapter implements TelephonyAdapter {
  readonly key = "telephony-external-disabled";
  readonly providerKey = "TELEPHONY_EXTERNAL_DISABLED";
  readonly externalEgress = false as const;
  async start(): Promise<never> { throw new TelephonyTransportError("TELEPHONY_EXTERNAL_EGRESS_DISABLED", false); }
  async cancel(): Promise<never> { throw new TelephonyTransportError("TELEPHONY_EXTERNAL_EGRESS_DISABLED", false); }
  normalizeStatus(): never { throw new TelephonyTransportError("TELEPHONY_EXTERNAL_EGRESS_DISABLED", false); }
  getRecordingReference() { return null; }
  verifyIdentity() { return { verified: true as const, mode: "LOCAL_DETERMINISTIC" as const }; }
  async health() { return { ready: true as const, externalEgress: false as const, recording: false as const, transcription: false as const }; }
}

export const localTelephonySimulator = new LocalTelephonySimulatorAdapter();
