type ProspectingTaskResultRow = Readonly<{
  kind: string;
  result: string | null;
  count: number;
}>;

export type ProspectingTaskResultSummary = Readonly<{
  callsCompleted: number;
  callsConnected: number;
  callsNoAnswer: number;
  callsBusy: number;
  callsVoicemail: number;
  callsFailed: number;
  instagramMessagesSent: number;
  instagramFollowsCompleted: number;
}>;

export function summarizeProspectingTaskResults(
  rows: readonly ProspectingTaskResultRow[],
): ProspectingTaskResultSummary {
  const count = (kind: string, results?: readonly string[]) => rows
    .filter((row) => row.kind === kind && (!results || (row.result !== null && results.includes(row.result))))
    .reduce((total, row) => total + row.count, 0);

  return Object.freeze({
    callsCompleted: count("CALL"),
    callsConnected: count("CALL", ["CONNECTED"]),
    callsNoAnswer: count("CALL", ["NO_ANSWER"]),
    callsBusy: count("CALL", ["BUSY"]),
    callsVoicemail: count("CALL", ["VOICEMAIL"]),
    callsFailed: count("CALL", ["WRONG_NUMBER", "CHANNEL_UNAVAILABLE"]),
    instagramMessagesSent: count("INSTAGRAM_MESSAGE", ["SENT"]),
    instagramFollowsCompleted: count("INSTAGRAM_FOLLOW", ["COMPLETED", "ALREADY_FOLLOWING"]),
  });
}
