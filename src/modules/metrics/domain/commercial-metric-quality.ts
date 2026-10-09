export const COMMERCIAL_METRIC_BACKFILL_RULE_VERSION = 20;
export const COMMERCIAL_METRIC_RECONCILIATION_RULE_VERSION = 12;

type BackfillRun = Readonly<{
  mode: string;
  status: string;
  ruleVersion: number;
  reviewCount: number;
  skippedCount: number;
  failedCount: number;
  finishedAt?: Date | null;
}> | null;

type ReconciliationRun = Readonly<{
  status: string;
  ruleVersion: number;
  divergentCheckCount: number;
  finishedAt?: Date | null;
}> | null;

export function commercialMetricQuality(backfill: BackfillRun, reconciliation: ReconciliationRun) {
  const historicalCoverageConfirmed = backfill?.mode === "APPLY"
    && backfill.status === "COMPLETED"
    && backfill.ruleVersion === COMMERCIAL_METRIC_BACKFILL_RULE_VERSION
    && backfill.reviewCount === 0 && backfill.skippedCount === 0 && backfill.failedCount === 0;
  const reconciliationAfterBackfill = Boolean(historicalCoverageConfirmed && backfill?.finishedAt && reconciliation?.finishedAt
    && reconciliation.finishedAt >= backfill.finishedAt);
  const reconciliationState = reconciliation?.status === "RUNNING" ? "DELAYED" as const
    : reconciliation?.status !== "COMPLETED" || reconciliation.ruleVersion !== COMMERCIAL_METRIC_RECONCILIATION_RULE_VERSION
      ? "UNAVAILABLE" as const
      : reconciliation.divergentCheckCount > 0 || !reconciliationAfterBackfill
        ? "PARTIAL" as const
        : "AVAILABLE" as const;
  const backfillReason = !backfill ? "Preenchimento histórico ainda não aplicado."
    : backfill.ruleVersion !== COMMERCIAL_METRIC_BACKFILL_RULE_VERSION ? "Preenchimento histórico de versão anterior."
      : backfill.status !== "COMPLETED" ? `Preenchimento histórico: ${backfill.status}.`
        : historicalCoverageConfirmed ? "Preenchimento histórico aplicado."
          : "Preenchimento histórico exige revisão de itens pendentes.";
  const reconciliationReason = !reconciliation ? "Conciliação ainda não executada."
    : reconciliation.ruleVersion !== COMMERCIAL_METRIC_RECONCILIATION_RULE_VERSION ? "Conciliação de versão anterior."
      : reconciliation.status !== "COMPLETED" ? `Conciliação: ${reconciliation.status}.`
        : reconciliation.divergentCheckCount > 0 ? `Conciliação encontrou ${reconciliation.divergentCheckCount} divergência(s).`
          : !reconciliationAfterBackfill ? "Conciliação precisa ser executada após o preenchimento histórico atual."
            : "Conciliação sem divergências.";
  return Object.freeze({
    historicalCoverageBasisPoints: reconciliationState === "AVAILABLE" ? 10_000 : null,
    reconciliationState,
    reason: `${backfillReason} ${reconciliationReason}`,
  });
}
