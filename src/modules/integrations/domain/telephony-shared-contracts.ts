export const telephonyScenarios = [
  "ANSWERED_COMPLETED",
  "BUSY",
  "NO_ANSWER",
  "CANCELLED",
  "VOICEMAIL",
  "TRANSIENT_FAILURE",
  "PERMANENT_FAILURE",
  "MULTI_LEG_TRANSFER",
  "TIMEOUT",
] as const;

export type TelephonyScenario = (typeof telephonyScenarios)[number];
