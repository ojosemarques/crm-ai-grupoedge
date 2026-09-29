const REDACTED = "[REMOVIDO]";
const SENSITIVE_KEY = /(?:password|passwd|secret|token|cookie|authorization|api[-_]?key|session|credential|private[-_]?key)/i;
const PII_KEYS = new Set(["email", "normalizedemail", "phone", "normalizedphone", "telefone", "cpf", "cnpj", "document", "documento", "address", "endereco", "name", "nome", "fullname", "displayname", "preferredname", "legalname", "message", "payload", "body"]);
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-\s]?\d{4}/g;
const POSTGRES_URL = /postgres(?:ql)?:\/\/[^\s"'<>]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const COOKIE_VALUE = /\b(?:session|auth|token)=[^;\s]+/gi;
const PRIVATE_KEY = /-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g;
const WORKSPACE_KEYS = new Set(["workspace", "workspaceid", "workspaceslug"]);

export const SAFE_METRIC_LABELS = new Set(["route", "method", "status_class", "operation", "job_type", "outbox_status", "severity", "result", "workspace_bucket"]);

export function safeWorkspaceBucket(value: string): string {
  return `ws_${createTelemetryFingerprint(value).slice(0, 12)}`;
}

function createTelemetryFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${hash >>> 0}`.padStart(10, "0");
}

function redactString(value: string): string {
  return value
    .replace(PRIVATE_KEY, REDACTED)
    .replace(POSTGRES_URL, REDACTED)
    .replace(BEARER, "Bearer [REMOVIDO]")
    .replace(JWT, REDACTED)
    .replace(COOKIE_VALUE, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, REDACTED)
    .slice(0, 2_000);
}

export function redactTelemetryValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") {
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    if (WORKSPACE_KEYS.has(normalizedKey)) return safeWorkspaceBucket(value);
    return PII_KEYS.has(normalizedKey) ? REDACTED : redactString(value);
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactTelemetryValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([entryKey, entryValue]) => [entryKey, redactTelemetryValue(entryValue, entryKey)]));
  }
  return value;
}

export function sanitizeMetricLabels(labels: Readonly<Record<string, string>>): Record<string, string> {
  const entries = Object.entries(labels);
  if (entries.length > 12) throw new Error("TELEMETRY_LABEL_LIMIT_EXCEEDED");
  const sanitized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!SAFE_METRIC_LABELS.has(key)) throw new Error(`TELEMETRY_LABEL_NOT_ALLOWED:${key}`);
    if (value.length > 80 || /[@+]|\d{7,}/.test(value)) throw new Error(`TELEMETRY_LABEL_HIGH_CARDINALITY:${key}`);
    sanitized[key] = value;
  }
  return sanitized;
}
