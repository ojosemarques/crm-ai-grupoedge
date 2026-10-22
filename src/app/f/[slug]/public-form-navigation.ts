import type { MarketingFormQuestion } from "@/modules/marketing-forms/domain/marketing-form-contracts";

export function shouldAutoAdvanceSingleChoice(
  questionType: MarketingFormQuestion["type"],
  index: number,
  questionCount: number,
): boolean {
  return questionType === "SINGLE_CHOICE" && index < questionCount - 1;
}
