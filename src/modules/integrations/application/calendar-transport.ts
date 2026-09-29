import type { MeetingStatus } from "@/generated/prisma/client";
import { CALENDAR_PROVIDER_KEY, type CalendarScenario } from "@/modules/integrations/domain/calendar-contracts";

export type CalendarAdapterCommand = Readonly<{
  meetingId: string;
  externalEventId: string;
  operation: "CREATE" | "UPDATE" | "RESCHEDULE" | "CANCEL";
  meetingRevision: number;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  status: MeetingStatus;
  scenario: CalendarScenario;
  attempt: number;
}>;

export type CalendarAdapterResult = Readonly<{
  externalEventId: string;
  externalVersion: number;
  externalEtag: string;
  appliedOperation: CalendarAdapterCommand["operation"];
  simulated: true;
  externalEgress: false;
}>;

export interface CalendarAdapter {
  readonly key: string;
  readonly providerKey: string;
  readonly externalEgress: false;
  push(command: CalendarAdapterCommand): Promise<CalendarAdapterResult>;
  health(): Promise<Readonly<{ ready: true; externalEgress: false; bidirectional: true }>>;
}

export class CalendarTransportError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = "CalendarTransportError";
  }
}

export class LocalCalendarSandboxAdapter implements CalendarAdapter {
  readonly key = "calendar-channel-v1";
  readonly providerKey = CALENDAR_PROVIDER_KEY;
  readonly externalEgress = false as const;

  async push(command: CalendarAdapterCommand): Promise<CalendarAdapterResult> {
    if (command.scenario === "PERMANENT_FAILURE") throw new CalendarTransportError("CALENDAR_LOCAL_PERMANENT_FAILURE", false);
    if (command.scenario === "TIMEOUT") throw new CalendarTransportError("CALENDAR_LOCAL_TIMEOUT", true);
    if (command.scenario === "TRANSIENT_FAILURE" && command.attempt < 3) throw new CalendarTransportError("CALENDAR_LOCAL_TRANSIENT_FAILURE", true);
    return {
      externalEventId: command.externalEventId,
      externalVersion: command.meetingRevision,
      externalEtag: `local:${command.meetingId}:r${command.meetingRevision}`,
      appliedOperation: command.operation,
      simulated: true,
      externalEgress: false,
    };
  }

  async health() {
    return { ready: true as const, externalEgress: false as const, bidirectional: true as const };
  }
}

export class ExternalCalendarDisabledAdapter implements CalendarAdapter {
  readonly key = "calendar-external-disabled";
  readonly providerKey = "CALENDAR_EXTERNAL_DISABLED";
  readonly externalEgress = false as const;
  async push(): Promise<never> { throw new CalendarTransportError("CALENDAR_EXTERNAL_EGRESS_DISABLED", false); }
  async health() { return { ready: true as const, externalEgress: false as const, bidirectional: true as const }; }
}

export const localCalendarSandbox = new LocalCalendarSandboxAdapter();
