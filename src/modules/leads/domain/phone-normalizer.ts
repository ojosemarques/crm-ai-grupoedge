export type PhoneNormalizationResult =
  | Readonly<{ success: true; normalizedPhone: string; countryCode: string }>
  | Readonly<{
      success: false;
      code: "PHONE_INVALID" | "PHONE_AMBIGUOUS";
      message: string;
    }>;

export type PhoneIdentityResult =
  | Readonly<{
      success: true;
      normalizedPhone: string;
      countryCode: string;
      extension: string | null;
      identity: string;
    }>
  | Extract<PhoneNormalizationResult, { success: false }>;

const e164Pattern = /^\+[1-9][0-9]{7,14}$/;
const acceptedCharactersPattern = /^[+0-9().\s-]+$/;
const extensionSuffixPattern = /\s+(?:ramal|ram\.?|ext(?:ens[aã]o)?\.?|x)\s*[:.#-]?\s*([0-9]{1,6})\s*$/i;

export function splitPhoneExtension(input: string): Readonly<{ phone: string; extension: string | null }> {
  const value = input.trim();
  const match = extensionSuffixPattern.exec(value);
  if (!match || match.index === 0) return { phone: value, extension: null };
  return { phone: value.slice(0, match.index).trim(), extension: match[1] ?? null };
}

function validBrazilianNationalNumber(value: string): boolean {
  return /^[1-9][1-9][2-9][0-9]{7,8}$/.test(value);
}

function fromInternational(value: string): PhoneNormalizationResult {
  const digits = value.slice(1).replace(/\D/g, "");
  const normalizedPhone = `+${digits}`;

  if (!e164Pattern.test(normalizedPhone)) {
    return {
      success: false,
      code: "PHONE_INVALID",
      message: "Informe um telefone internacional válido no formato E.164.",
    };
  }

  return {
    success: true,
    normalizedPhone,
    countryCode: digits.startsWith("55") ? "55" : digits.slice(0, 3),
  };
}

export function normalizePhone(input: string): PhoneNormalizationResult {
  const value = splitPhoneExtension(input).phone;
  if (!value || !acceptedCharactersPattern.test(value)) {
    return {
      success: false,
      code: "PHONE_INVALID",
      message: "Informe um telefone contendo apenas dígitos e sinais de formatação.",
    };
  }

  if (value.startsWith("+")) {
    return fromInternational(value);
  }

  if (value.startsWith("00")) {
    return fromInternational(`+${value.slice(2)}`);
  }

  let digits = value.replace(/\D/g, "");

  // Prefixo de operadora brasileiro (0XX) antes de DDD e número.
  if (digits.startsWith("0") && (digits.length === 13 || digits.length === 14)) {
    digits = digits.slice(3);
  } else if (
    digits.startsWith("0") &&
    (digits.length === 11 || digits.length === 12)
  ) {
    // Prefixo tronco zero antes do DDD.
    digits = digits.slice(1);
  }

  if (
    digits.startsWith("55") &&
    (digits.length === 12 || digits.length === 13) &&
    validBrazilianNationalNumber(digits.slice(2))
  ) {
    return {
      success: true,
      normalizedPhone: `+${digits}`,
      countryCode: "55",
    };
  }

  if (
    (digits.length === 10 || digits.length === 11) &&
    validBrazilianNationalNumber(digits)
  ) {
    return {
      success: true,
      normalizedPhone: `+55${digits}`,
      countryCode: "55",
    };
  }

  return {
    success: false,
    code: digits.length < 10 ? "PHONE_AMBIGUOUS" : "PHONE_INVALID",
    message:
      digits.length < 10
        ? "O telefone brasileiro precisa incluir DDD; números internacionais precisam começar com + ou 00."
        : "Informe um telefone brasileiro com DDD ou um número internacional com + ou 00.",
  };
}

export function normalizePhoneIdentity(input: string): PhoneIdentityResult {
  const { extension } = splitPhoneExtension(input);
  const normalized = normalizePhone(input);
  if (!normalized.success) return normalized;
  return {
    ...normalized,
    extension,
    identity: extension ? `${normalized.normalizedPhone};ext=${extension}` : normalized.normalizedPhone,
  };
}
