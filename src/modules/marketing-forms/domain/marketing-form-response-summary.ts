import type { Prisma } from "@/generated/prisma/client";
import {
  marketingFormDefinitionSchema,
  type MarketingFormDefinition,
} from "@/modules/marketing-forms/domain/marketing-form-contracts";

export type MarketingFormResponseAnswer = Readonly<{
  questionKey: string;
  question: string;
  displayValue: string;
}>;

export type MarketingFormResponseSummary = Readonly<{
  receiptId: string;
  formName: string;
  submittedAt: string;
  phone: string | null;
  answers: readonly MarketingFormResponseAnswer[];
}>;

function answerLabel(
  definition: MarketingFormDefinition,
  questionKey: string,
  value: unknown,
): string {
  const question = definition.questions.find((item) => item.stableKey === questionKey);
  if (!question) return String(value ?? "");
  const options = question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE" || question.type === "DROPDOWN"
    ? question.config.options
    : null;
  if (options) {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((key) => options.find((option) => option.stableKey === key)?.label ?? String(key))
      .join(" | ");
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value ?? "");
}

function storedAnswers(value: Prisma.JsonValue): Array<{ questionKey: string; value: Prisma.JsonValue }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.questionKey !== "string" ||
      !("value" in item) ||
      item.value === undefined
    ) return [];
    return [{ questionKey: item.questionKey, value: item.value }];
  });
}

export function summarizeMarketingFormAnswers(
  definitionValue: Prisma.JsonValue,
  answersValue: Prisma.JsonValue,
): readonly MarketingFormResponseAnswer[] {
  const definition = marketingFormDefinitionSchema.safeParse(definitionValue);
  if (!definition.success) return [];
  const answers = new Map(storedAnswers(answersValue).map((answer) => [answer.questionKey, answer.value]));
  return definition.data.questions.flatMap((question) => {
    const value = answers.get(question.stableKey);
    if (value === undefined) return [];
    return [{
      questionKey: question.stableKey,
      question: question.title,
      displayValue: answerLabel(definition.data, question.stableKey, value),
    }];
  });
}
