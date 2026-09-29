import { createHash } from "node:crypto";

import type { AIAnalysisInput } from "@/modules/ai/domain/ai-contracts";
import { forbiddenAIInputFields, type AIUseCaseKey } from "@/modules/ai/domain/ai-governance-contracts";

const forbiddenKey = new RegExp(`(^|[._-])(${forbiddenAIInputFields.join("|")})($|[._-])`, "i");
const secretPatterns = [
  /\b(?:bearer|token|secret|password|senha)\s*[:=]\s*\S+/gi,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
  /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}/g,
];
const injectionPatterns = [
  /ignore (?:all )?(?:previous|prior) instructions?/i,
  /desconsidere (?:todas )?(?:as )?instru[cç][oõ]es/i,
  /system prompt/i,
  /developer message/i,
  /revele? (?:o )?(?:prompt|segredo|token)/i,
];

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

export function fingerprintAIValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function redactText(value: string): { value: string; redactions: number; injection: boolean } {
  let redactions = 0;
  let next = value;
  for (const pattern of secretPatterns) {
    next = next.replace(pattern, () => {
      redactions += 1;
      return "[DADO_RESTRITO]";
    });
  }
  const injection = injectionPatterns.some((pattern) => pattern.test(next));
  if (injection) next = "[CONTEUDO_NAO_CONFIAVEL_REMOVIDO]";
  return { value: next, redactions, injection };
}

export type AISafetyResult = Readonly<{
  input: AIAnalysisInput;
  inputFingerprint: string;
  allowedFieldCount: number;
  blockedFieldCount: number;
  redactionMetadata: Readonly<{
    policyVersion: 1;
    redactionCount: number;
    blockedFieldKeys: readonly string[];
    promptInjectionDetected: boolean;
  }>;
  estimatedInputTokens: number;
}>;

export function minimizeAIInput(
  useCaseKey: AIUseCaseKey,
  input: AIAnalysisInput,
  allowedTopLevelFields: readonly string[],
): AISafetyResult {
  const allowed = new Set(allowedTopLevelFields);
  const blockedFieldKeys = new Set<string>();
  let redactionCount = 0;
  let promptInjectionDetected = false;

  const facts = allowed.has("facts")
    ? input.facts.flatMap((fact) => {
        if (forbiddenKey.test(fact.field)) {
          blockedFieldKeys.add(fact.field);
          return [];
        }
        const value = redactText(fact.value);
        const evidence = fact.evidence ? redactText(fact.evidence) : null;
        redactionCount += value.redactions + (evidence?.redactions ?? 0);
        promptInjectionDetected ||= value.injection || Boolean(evidence?.injection);
        return [{ ...fact, value: value.value, ...(evidence ? { evidence: evidence.value } : {}) }];
      })
    : [];

  const excerpt = allowed.has("textExcerpt") && input.textExcerpt
    ? redactText(input.textExcerpt)
    : null;
  if (excerpt) {
    redactionCount += excerpt.redactions;
    promptInjectionDetected ||= excerpt.injection;
  }

  const safe: AIAnalysisInput = {
    facts,
    requiredFields: allowed.has("requiredFields")
      ? input.requiredFields.filter((field) => {
          if (!forbiddenKey.test(field)) return true;
          blockedFieldKeys.add(field);
          return false;
        })
      : [],
    ...(allowed.has("scoreSignals") && input.scoreSignals ? { scoreSignals: input.scoreSignals } : {}),
    pacto: allowed.has("pacto") ? input.pacto : [],
    currentState: allowed.has("currentState") ? input.currentState : {},
    ...(excerpt ? { textExcerpt: excerpt.value } : {}),
  };
  const serialized = JSON.stringify(stableValue(safe));
  return Object.freeze({
    input: safe,
    inputFingerprint: fingerprintAIValue(safe),
    allowedFieldCount: facts.length + Object.keys(safe.currentState).length + safe.pacto.length,
    blockedFieldCount: blockedFieldKeys.size + (promptInjectionDetected ? 1 : 0),
    redactionMetadata: Object.freeze({
      policyVersion: 1,
      redactionCount,
      blockedFieldKeys: Object.freeze([...blockedFieldKeys].sort()),
      promptInjectionDetected,
    }),
    estimatedInputTokens: Math.ceil(serialized.length / 4),
  });
}
