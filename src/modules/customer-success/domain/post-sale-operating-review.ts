export type DeliveryProgress = Readonly<{ total: number; completed: number; overdue: number }>;

export function progress(total: number, completed: number, overdue: number): DeliveryProgress & { completionRate: number | null } {
  return { total, completed, overdue, completionRate: total === 0 ? null : completed / total };
}

export function capacityState(loadUnits: number) {
  if (loadUnits > 25) return "FULL" as const;
  if (loadUnits > 15) return "ATTENTION" as const;
  return "AVAILABLE" as const;
}

export function postSaleRisks(input: Readonly<{
  healthStatus: string | null;
  blockedPlans: number;
  overdueDeliverables: number;
  overdueRequests: number;
  urgentRequests: number;
  renewalRiskLevel: string | null;
}>) {
  const risks: Array<{ code: string; severity: "MEDIUM" | "HIGH" | "CRITICAL" }> = [];
  if (input.healthStatus === "RISK") risks.push({ code: "CUSTOMER_HEALTH_RISK", severity: "HIGH" });
  if (input.healthStatus === "INSUFFICIENT" || input.healthStatus === null) risks.push({ code: "HEALTH_DATA_INSUFFICIENT", severity: "MEDIUM" });
  if (input.blockedPlans > 0) risks.push({ code: "SUCCESS_PLAN_BLOCKED", severity: "HIGH" });
  if (input.overdueDeliverables > 0) risks.push({ code: "DELIVERABLE_OVERDUE", severity: "HIGH" });
  if (input.overdueRequests > 0) risks.push({ code: "REQUEST_SLA_OVERDUE", severity: "HIGH" });
  if (input.urgentRequests > 0) risks.push({ code: "URGENT_REQUEST_OPEN", severity: "CRITICAL" });
  if (input.renewalRiskLevel === "HIGH" || input.renewalRiskLevel === "CRITICAL") {
    risks.push({ code: "RENEWAL_AT_RISK", severity: input.renewalRiskLevel });
  }
  return risks;
}
