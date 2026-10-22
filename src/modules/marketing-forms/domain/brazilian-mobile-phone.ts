const BRAZILIAN_MOBILE_DIGITS = 11;
const ACCEPTED_PHONE_CHARACTERS = /^[+0-9().\s-]+$/;

function nationalDigits(value: string): string {
  const trimmed = value.trim();
  let digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+55")) digits = digits.slice(2);
  else if (trimmed.startsWith("0055")) digits = digits.slice(4);

  return digits;
}

export function formatBrazilianMobilePhone(value: string): string {
  const digits = nationalDigits(value).slice(0, BRAZILIAN_MOBILE_DIGITS);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;

  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  if (number.length <= 5) return `(${ddd})${number}`;

  return `(${ddd})${number.slice(0, 5)}-${number.slice(5)}`;
}

export function brazilianMobilePhoneError(value: string): string | null {
  const trimmed = value.trim();
  const misplacedPlus = trimmed.includes("+") && (!trimmed.startsWith("+55") || trimmed.slice(1).includes("+"));
  const digits = nationalDigits(value);
  return ACCEPTED_PHONE_CHARACTERS.test(trimmed) && !misplacedPlus && /^[1-9]{2}9\d{8}$/.test(digits) && digits.length === BRAZILIAN_MOBILE_DIGITS
    ? null
    : "Informe um WhatsApp com DDD e 11 dígitos: (62)98579-6723.";
}
