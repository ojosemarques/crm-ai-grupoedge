import { summarizeMarketingFormAnswers, type MarketingFormResponseAnswer } from "./marketing-form-response-summary";

export const formBudgetTags = ["SEM BUDGET", "GREEN BUDGET", "YELLOW BUDGET"] as const;
export type FormBudgetTag = (typeof formBudgetTags)[number];
export type FormBudgetObservation = Readonly<{ tag: FormBudgetTag; observedAt: Date; finalized: boolean }>;

function normalized(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function budgetQuestion(answer: MarketingFormResponseAnswer) {
  return normalized(answer.questionKey) === "investimento mensal"
    || /\b(?:quanto|dispost[oa]s?|disposicao)\b.*\binvest(?:ir|imento)\b/.test(normalized(answer.question));
}

export function formBudgetObservation(
  answers: readonly MarketingFormResponseAnswer[],
  observedAt: Date,
  finalized: boolean,
) {
  const answer = answers.find(budgetQuestion);
  if (!answer || /^(?:opcao|option)[_-]/i.test(answer.displayValue)) return null;
  const value = normalized(answer.displayValue);
  if (!value) return null;
  let tag: FormBudgetTag = "YELLOW BUDGET";
  if (/^(?:no momento |por enquanto )?nao(?:$| (?:estou disposto|tenho orcamento|pretendo investir|posso investir|quero investir)\b)|^sem (?:orcamento|budget)\b/.test(value)) {
    tag = "SEM BUDGET";
  } else if (/^sim(?: estou dispost[oa]| com certeza| eu estou dispost[oa])?$/.test(value)) {
    tag = "GREEN BUDGET";
  }
  return { tag, observedAt, finalized };
}

export function marketingFormBudgetObservation(definition: unknown, answers: unknown, observedAt: Date, finalized: boolean) {
  const summary = summarizeMarketingFormAnswers(definition, answers);
  if (!finalized && Array.isArray(answers)) {
    const question = summary.find(budgetQuestion);
    const answeredAt = answers.find((answer) => answer && answer.questionKey === question?.questionKey)?.answeredAt;
    if (typeof answeredAt === "string" && Number.isFinite(Date.parse(answeredAt))) observedAt = new Date(answeredAt);
  }
  return formBudgetObservation(summary, observedAt, finalized);
}
