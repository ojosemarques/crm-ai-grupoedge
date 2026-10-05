export type LeadCardTask = Readonly<{
  id: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  priority: string;
  dueAt: string;
  completedAt: string | null;
  result: string | null;
  overdue: boolean;
}>;

export type LeadCardTimelineEntry = Readonly<{
  id: string;
  type: string;
  direction: string;
  result: string | null;
  subject: string;
  description: string | null;
  occurredAt: string;
  durationSeconds: number | null;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  previousValues: unknown;
  newValues: unknown;
  correctsActivityId: string | null;
  actor: Readonly<{ name: string; type: string }>;
}>;

export type LeadCardOperations = Readonly<{
  generatedAt: string;
  timeZone: string;
  permissions: Readonly<{
    canWrite: boolean;
    canManageTasks: boolean;
    canAssign: boolean;
    canReadAudit: boolean;
  }>;
  assignmentTargets: readonly Readonly<{ id: string; name: string }>[];
  lead: Readonly<{
    id: string;
    updatedAt: string;
    fullName: string;
    normalizedPhone: string | null;
    normalizedEmail: string | null;
    jobTitle: string | null;
    organizationName: string | null;
    account: Readonly<{ id: string; name: string }> | null;
    accountIdentityReview: Readonly<{
      id: string;
      reason: string;
      createdAt: string;
    }> | null;
    city: string | null;
    stateCode: string | null;
    interestSummary: string | null;
    budgetCents: string | null;
    contactPreference: string;
    status: string;
    stageName: string;
    priorityCode: "P1" | "P2" | "P3" | null;
    score: number | null;
    priorityReason: string | null;
    operationalOwner: string;
    ownerMemberId: string | null;
    queueId: string | null;
    sourceName: string;
    campaignName: string | null;
    creativeName: string | null;
    receivedAt: string;
    latestSubmissionAt: string | null;
    conversionCount: number;
    needsIdentityReview: boolean;
    awaitingHumanResponse: boolean;
    lastInboundResponseAt: string | null;
    sla: Readonly<{
      policyName: string;
      elapsedSeconds: number;
      healthyMaxSeconds: number;
      attentionMaxSeconds: number;
      firstHumanAttemptAt: string | null;
      firstConnectedAt: string | null;
      firstHumanAttemptSeconds: number | null;
      firstResponseTimeSeconds: number | null;
    }>;
    lastActivity: Readonly<{
      subject: string;
      occurredAt: string;
    }> | null;
    nextAction: Readonly<{
      taskId: string;
      title: string;
      dueAt: string;
    }> | null;
    nextActionIssue: string | null;
  }>;
  summary: Readonly<{
    activities: Readonly<{
      total: number;
      calls: number;
      connectedCalls: number;
      messages: number;
      emails: number;
      meetings: number;
      completedFollowUps: number;
      completedTasks: number;
    }>;
    latestSubmission: Readonly<{
      channel: string | null;
      submittedAt: string;
      fullName: string | null;
      email: string | null;
      phone: string | null;
      jobTitle: string | null;
      organizationName: string | null;
      city: string | null;
      stateCode: string | null;
      interestSummary: string | null;
      budgetCents: string | null;
      contactPreference: string | null;
      sourceName: string;
      campaignName: string | null;
      creativeName: string | null;
    }> | null;
    alerts: readonly Readonly<{
      key: string;
      title: string;
      message: string;
      createdAt: string;
    }>[];
    missingFields: readonly string[];
  }>;
  tasks: readonly LeadCardTask[];
  timeline: readonly LeadCardTimelineEntry[];
  nextCursor: string | null;
}>;
