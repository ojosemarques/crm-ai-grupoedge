import type {
  MarketingFormDefinition,
  MarketingFormQuestion,
} from "@/modules/marketing-forms/domain/marketing-form-contracts";
import type { PublicFormSubmitInput } from "@/modules/marketing-forms/domain/public-form-contracts";
import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
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

function mappedAnswerError(question: MarketingFormQuestion, value: AnswerValue): string | null {
  if (!question.mapping) return null;
  if (question.mapping === "contactPreference") return typeof value === "boolean" ? null : "Resposta inválida.";
  if (question.mapping === "budgetCents") {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? null
      : "Informe um orçamento inteiro e não negativo.";
  }
  if (typeof value !== "string") return "Resposta inválida.";
  const trimmed = value.trim();
  if (question.mapping === "fullName") {
    if (trimmed.length < 2) return "Informe um nome com pelo menos 2 caracteres.";
    if (trimmed.length > 200) return "Use no máximo 200 caracteres.";
  }
  if (question.mapping === "phone") {
    if (trimmed.length > 80) return "Use no máximo 80 caracteres.";
    const normalized = normalizePhone(trimmed);
    if (!normalized.success) return normalized.message;
  }
  if (question.mapping === "email" && (trimmed.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed))) return "Informe um e-mail válido.";
  if (question.mapping === "jobTitle" && trimmed.length > 160) return "Use no máximo 160 caracteres.";
  if (question.mapping === "organizationName" && trimmed.length > 200) return "Use no máximo 200 caracteres.";
  if (question.mapping === "city" && trimmed.length > 120) return "Use no máximo 120 caracteres.";
  if (question.mapping === "stateCode" && trimmed.length !== 2) return "Informe a UF com 2 caracteres.";
  if (question.mapping === "interestSummary" && trimmed.length > 2_000) return "Use no máximo 2000 caracteres.";
  return null;
}

export function publicFormAnswerError(question: MarketingFormQuestion, value: AnswerValue | undefined): string | null {
  if (question.required && empty(value)) return "Responda esta pergunta para continuar.";
  if (value === undefined || empty(value)) return null;
  const mappingError = mappedAnswerError(question, value);
  if (mappingError) return mappingError;
  if (question.type === "CHECKBOX") {
    return typeof value === "boolean" ? null : "Resposta inválida.";
  }
  if (question.type === "NUMBER") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Informe um número válido.";
    if (question.config.min !== undefined && value < question.config.min) return `O mínimo é ${question.config.min}.`;
    if (question.config.max !== undefined && value > question.config.max) return `O máximo é ${question.config.max}.`;
    return null;
  }
  if (question.type === "MULTIPLE_CHOICE") {
    if (!Array.isArray(value) || new Set(value).size !== value.length) return "Seleção inválida.";
    const allowed = new Set(question.config.options.map((option) => option.stableKey));
    if (value.some((key) => !allowed.has(key))) return "Seleção inválida.";
    if (value.length < question.config.minSelections) return `Escolha pelo menos ${question.config.minSelections}.`;
    if (question.config.maxSelections !== undefined && value.length > question.config.maxSelections) return `Escolha no máximo ${question.config.maxSelections}.`;
    return null;
  }
  if (typeof value !== "string") return "Resposta inválida.";
  if (question.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Informe um e-mail válido.";
  if (question.type === "PHONE") {
    const normalized = normalizePhone(value);
    if (!normalized.success) return normalized.message;
  }
  if (question.type === "DATE") {
    if (!isValidIsoDate(value)) return "Informe uma data válida.";
    if (question.config.min && value < question.config.min) return `Escolha uma data a partir de ${question.config.min}.`;
    if (question.config.max && value > question.config.max) return `Escolha uma data até ${question.config.max}.`;
  }
  if (question.type === "SHORT_TEXT" || question.type === "LONG_TEXT") {
    if (question.config.minLength !== undefined && value.length < question.config.minLength) return `Use pelo menos ${question.config.minLength} caracteres.`;
    if (value.length > question.config.maxLength) return `Use no máximo ${question.config.maxLength} caracteres.`;
  }
  if (question.type === "SINGLE_CHOICE" || question.type === "DROPDOWN") {
    if (!question.config.options.some((option) => option.stableKey === value)) return "Seleção inválida.";
  }
  return null;
}

function validateAnswer(question: MarketingFormQuestion, value: AnswerValue | undefined): void {
  const error = publicFormAnswerError(question, value);
  if (error) invalid(question.stableKey, error);
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
