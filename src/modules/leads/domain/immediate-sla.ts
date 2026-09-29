export type ImmediateSlaBand = "HEALTHY" | "ATTENTION" | "CRITICAL";

export type ImmediateSlaThresholds = Readonly<{
  healthyMaxSeconds: number;
  attentionMaxSeconds: number;
}>;

export function classifyImmediateSla(
  elapsedSeconds: number,
  thresholds: ImmediateSlaThresholds,
): ImmediateSlaBand {
  if (
    !Number.isInteger(elapsedSeconds) ||
    elapsedSeconds < 0 ||
    !Number.isInteger(thresholds.healthyMaxSeconds) ||
    !Number.isInteger(thresholds.attentionMaxSeconds) ||
    thresholds.healthyMaxSeconds < 0 ||
    thresholds.attentionMaxSeconds <= thresholds.healthyMaxSeconds
  ) {
    throw new RangeError("Tempo e faixas do SLA devem ser inteiros válidos.");
  }

  if (elapsedSeconds <= thresholds.healthyMaxSeconds) return "HEALTHY";
  if (elapsedSeconds <= thresholds.attentionMaxSeconds) return "ATTENTION";
  return "CRITICAL";
}
