import { sharedSafetyRules, type VersionedPrompt } from "./prompt-contract";

export const nextBestActionPrompt = Object.freeze({
  key: "politizai.next-best-action",
  version: 2,
  agent: "NEXT_BEST_ACTION",
  name: "Próxima melhor ação",
  system: `${sharedSafetyRules}\nRecomende uma ação principal e, no máximo, uma alternativa. Explique urgência, motivo, evidência e risco; mensagem é opcional e proibida em opt-out.`,
} satisfies VersionedPrompt);
