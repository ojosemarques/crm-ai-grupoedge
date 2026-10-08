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
  callsWrongNumber: number;
  callsChannelUnavailable: number;
  callsFailed: number;
  instagramMessagesCompleted: number;
  instagramMessagesSent: number;
  instagramMessagesProfileNotFound: number;
  instagramMessagesFailed: number;
  instagramFollowsAttempted: number;
  instagramFollowsCompleted: number;
  instagramFollowsAlreadyFollowing: number;
  instagramFollowsProfileNotFound: number;
  instagramFollowsFailed: number;
}>;

export function summarizeProspectingTaskResults(
  rows: readonly ProspectingTaskResultRow[],
): ProspectingTaskResultSummary {
  const count = (kind: string, results?: readonly string[]) => rows
    .filter((row) => row.kind === kind && (!results || (row.result !== null && results.includes(row.result))))
    .reduce((total, row) => total + row.count, 0);

  const callsWrongNumber = count("CALL", ["WRONG_NUMBER"]);
  const callsChannelUnavailable = count("CALL", ["CHANNEL_UNAVAILABLE"]);
  const instagramMessagesFailed = count("INSTAGRAM_MESSAGE", ["FAILED", "CHANNEL_UNAVAILABLE"]);
  const instagramFollowsFailed = count("INSTAGRAM_FOLLOW", ["FAILED", "CHANNEL_UNAVAILABLE"]);

  return Object.freeze({
    callsCompleted: count("CALL"),
    callsConnected: count("CALL", ["CONNECTED"]),
    callsNoAnswer: count("CALL", ["NO_ANSWER"]),
    callsBusy: count("CALL", ["BUSY"]),
    callsVoicemail: count("CALL", ["VOICEMAIL"]),
    callsWrongNumber,
    callsChannelUnavailable,
    callsFailed: callsWrongNumber + callsChannelUnavailable,
    instagramMessagesCompleted: count("INSTAGRAM_MESSAGE"),
    instagramMessagesSent: count("INSTAGRAM_MESSAGE", ["SENT"]),
    instagramMessagesProfileNotFound: count("INSTAGRAM_MESSAGE", ["PROFILE_NOT_FOUND"]),
    instagramMessagesFailed,
    instagramFollowsAttempted: count("INSTAGRAM_FOLLOW"),
    instagramFollowsCompleted: count("INSTAGRAM_FOLLOW", ["COMPLETED"]),
    instagramFollowsAlreadyFollowing: count("INSTAGRAM_FOLLOW", ["ALREADY_FOLLOWING"]),
    instagramFollowsProfileNotFound: count("INSTAGRAM_FOLLOW", ["PROFILE_NOT_FOUND"]),
    instagramFollowsFailed,
  });
}
