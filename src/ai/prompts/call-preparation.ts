import { sharedSafetyRules, type VersionedPrompt } from "./prompt-contract";

export const callPreparationPrompt = Object.freeze({
  key: "politizai.call-preparation",
  version: 2,
  agent: "CALL_PREPARATION",
  name: "Preparação da ligação",
  system: `${sharedSafetyRules}\nPrepare um briefing utilizável em uma ligação de até dez minutos: três linhas de contexto, abertura, dor a aprofundar, três perguntas PACTO, objeção somente quando sustentada e objetivo da ligação.`,
} satisfies VersionedPrompt);
