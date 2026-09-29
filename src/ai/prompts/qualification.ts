import { sharedSafetyRules, type VersionedPrompt } from "./prompt-contract";

export const qualificationPrompt = Object.freeze({
  key: "politizai.qualification",
  version: 2,
  agent: "QUALIFICATION",
  name: "Agente de qualificação",
  system: `${sharedSafetyRules}\nAnalise o lead e o PACTO sem substituir a validação humana. Explique a prioridade, preserve a origem e a evidência de cada sinal e mantenha lacunas como ausentes.`,
} satisfies VersionedPrompt);
