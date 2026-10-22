import type {
  MarketingFormDefinition,
  MarketingFormQuestion,
} from "@/modules/marketing-forms/domain/marketing-form-contracts";
import type { PublicFormSubmitInput } from "@/modules/marketing-forms/domain/public-form-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";

type AnswerValue = PublicFormSubmitInput["answers"][number]["value"];

function invalid(_questionKey: string, message: string): never {
  throw new ApplicationError(message, {
    code: "MARKETING_FORM_ANSWER_INVALID",
    statusCode: 422,
    expose: true,
  });
}

function empty(value: AnswerValue | undefined): boolean {
  return value === undefined || value === "" || value === false || (Array.isArray(value) && value.length === 0);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateAnswer(question: MarketingFormQuestion, value: AnswerValue | undefined): void {
  if (question.required && empty(value)) invalid(question.stableKey, "Responda todas as perguntas obrigatórias.");
  if (empty(value)) return;
  if (question.type === "CHECKBOX") {
    if (typeof value !== "boolean") invalid(question.stableKey, "Resposta inválida.");
    return;
  }
  if (question.type === "NUMBER") {
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(question.stableKey, "Número inválido.");
    if (question.config.min !== undefined && value < question.config.min) invalid(question.stableKey, "Número abaixo do mínimo.");
    if (question.config.max !== undefined && value > question.config.max) invalid(question.stableKey, "Número acima do máximo.");
    return;
  }
  if (question.type === "MULTIPLE_CHOICE") {
    if (!Array.isArray(value) || new Set(value).size !== value.length) invalid(question.stableKey, "Seleção inválida.");
    const allowed = new Set(question.config.options.map((option) => option.stableKey));
    if (value.some((key) => !allowed.has(key))) invalid(question.stableKey, "Seleção inválida.");
    if (value.length < question.config.minSelections || (question.config.maxSelections !== undefined && value.length > question.config.maxSelections)) invalid(question.stableKey, "Quantidade de opções inválida.");
    return;
  }
  if (typeof value !== "string") invalid(question.stableKey, "Resposta inválida.");
  if (question.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) invalid(question.stableKey, "E-mail inválido.");
  if (question.type === "PHONE" && value.replace(/\D/g, "").length < 8) invalid(question.stableKey, "Telefone inválido.");
  if (question.type === "DATE") {
    if (!isValidIsoDate(value)) invalid(question.stableKey, "Data inválida.");
    if (question.config.min && value < question.config.min) invalid(question.stableKey, "Data anterior ao mínimo.");
    if (question.config.max && value > question.config.max) invalid(question.stableKey, "Data posterior ao máximo.");
  }
  if (question.type === "SHORT_TEXT" || question.type === "LONG_TEXT") {
    if (question.config.minLength !== undefined && value.length < question.config.minLength) invalid(question.stableKey, "Resposta curta demais.");
    if (value.length > question.config.maxLength) invalid(question.stableKey, "Resposta longa demais.");
  }
  if (question.type === "SINGLE_CHOICE" || question.type === "DROPDOWN") {
    if (!question.config.options.some((option) => option.stableKey === value)) invalid(question.stableKey, "Seleção inválida.");
  }
}

export function validatePublicFormAnswers(
  definition: MarketingFormDefinition,
  submitted: PublicFormSubmitInput["answers"],
) {
  const byKey = new Map<string, AnswerValue>();
  for (const answer of submitted) {
    if (byKey.has(answer.questionKey)) invalid(answer.questionKey, "Pergunta repetida.");
    byKey.set(answer.questionKey, answer.value);
  }
  const known = new Set(definition.questions.map((question) => question.stableKey));
  for (const key of byKey.keys()) if (!known.has(key)) invalid(key, "Pergunta desconhecida para esta versão.");
  for (const question of definition.questions) validateAnswer(question, byKey.get(question.stableKey));
  return definition.questions.flatMap((question) => {
    const value = byKey.get(question.stableKey);
    return value === undefined ? [] : [{ questionKey: question.stableKey, value }];
  });
}

export function mapAnswersToLead(
  definition: MarketingFormDefinition,
  answers: ReturnType<typeof validatePublicFormAnswers>,
) {
  const values = new Map(answers.map((answer) => [answer.questionKey, answer.value]));
  const mapped: Record<string, AnswerValue> = {};
  for (const question of definition.questions) {
    const value = values.get(question.stableKey);
    if (question.mapping && value !== undefined && !Array.isArray(value)) mapped[question.mapping] = value;
  }
  if (typeof mapped.fullName !== "string" || typeof mapped.phone !== "string") {
    throw new ApplicationError("O formulário publicado não possui os campos obrigatórios do CRM.", {
      code: "MARKETING_FORM_MAPPING_INVALID",
      statusCode: 422,
      expose: true,
    });
  }
  return mapped;
}
